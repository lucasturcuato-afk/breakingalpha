# Entity-dedup plan (collision clusters from PR #405)

REVIEW-ONLY. The generator performs no DB writes; every mutation lives as
text in entity-dedup-plan.sql and is applied by a human, one cluster at a time.

## FK graph (discovered from pg_constraint)

| child table | fk column | on delete | nullable |
|---|---|---|---|
| aliases | canonical_id | CASCADE | no |
| company_mentions | company_id | NO ACTION | yes |
| financial_facts | company_id | SET NULL | yes |
| insider_transactions | company_id | SET NULL | yes |
| resolution_log | resolved_canonical_id | SET NULL | yes |
| sec_filings | company_id | SET NULL | yes |

UNIQUE on companies: companies_pkey(id), companies_name_key(name). sec_cik has
a non-unique partial index; ticker has NO unique constraint. A merge that
DELETEs duplicates frees their unique names and never inserts into companies,
so there is no unique-violation risk.

## String-reference hazards (NOT id FKs, NOT auto-repointed)

These reference companies by name/ticker STRING, so deleting a duplicate row
does not touch them:
- articles.companies (text[]), articles.primary_company (text) -- by NAME
- deal_flow.company (text) -- by NAME
- theses.ticker, sec_filings.ticker, insider_transactions.ticker,
  competitor_map.ticker, user_profiles.watchlist_tickers,
  user_signal_digest.top_engaged_tickers -- by TICKER

Mitigation: repointing aliases.canonical_id (an FK child, in the plan) moves a
retired company's existing surface forms to the survivor, so name-based
resolution keeps working for any name already aliased. A retired company NAME
that is NOT present in aliases is a residual: add it as a survivor alias before
deleting if article/deal_flow rows carry that exact name. Flagged for Noah.

## Count reconciliation (flagged)

- PR #405 phase-a.sql: 914 UPDATE rows; the #405 report stated 692
  collision-tagged rows and 457 collision GROUPS.

### VERIFY gate: partition of the 692 collision-tagged rows

The 692 collision-tagged rows are the partition universe. Each lives in
exactly one CIK cluster; each cluster is bucket A/B (safe) or C (quarantine),
so every tagged row is classified, and the two sum to 692 by construction:
- safe, in safe clusters (A/B): 553
- safe, no live collision (DB drift since #405, no action): 4
- safe TOTAL: 557
- quarantined (bucket C): 135
- safe + quarantined = 692 == 692 (GATE: == 692)
- GATE PASS.
- DB-drift no-ops (4): rows collision-tagged at the #405 snapshot
  whose CIK no longer forms a 2+ member cluster live (the duplicate sibling was
  already removed). Nothing to merge; no action. Confirms #405's 692 vs the live
  state, reconciled not silently dropped.

### Supplementary finding (NOT part of the 692 gate), flagged for Noah

- Clusters: A=244, B=52, C(quarantine)=86;
  total clusters=382.
- Total retire rows incl. already-populated dups: safe=499, quarantined=267, total=766.
- The 74 rows beyond 692 are ALREADY-POPULATED
  duplicate companies the #405 artifact never contained (it held only NULL-cik
  rows). They surface only from the live re-derivation, cluster as pop-vs-pop,
  and are QUARANTINED (bucket C) for Noah: deleting a populated company with
  its own history is a human call, never auto-run. This is a real scope finding,
  not a defect; both numbers are printed, nothing was forced.

## Canonical survivor rule

Per cluster, pick the survivor deterministically:
1. prefer a member carrying BOTH ticker and sec_cik;
2. tie-break: most child rows across the six FK tables;
3. then earliest first_seen; then lowest id (stable).
Any cluster whose members carry two DIFFERENT non-null tickers or two
different non-null sec_ciks is a CONFLICT -> bucket C (quarantine), never
auto-merged.

### Worked examples

**PTC** (bucket A, cik 857005): members [PTC Inc.(t=None,cik=None,children=33); PTC Inc(t=None,cik=None,children=2); PTC(t=PTC,cik=857005,children=959)]. Survivor -> PTC (06fbd7ab-3178-4f60-9853-ab996de966f8).

**AAOI** (bucket A, cik 1158114): members [Applied Optoelectronics Inc(t=None,cik=None,children=2); Applied Optoelectronics(t=None,cik=None,children=70); Applied Optoelectronics, Inc.(t=None,cik=None,children=4); Applied Optoelectronics Inc.(t=None,cik=None,children=1); AAOI(t=AAOI,cik=1158114,children=27)]. Survivor -> AAOI (d88cfc6c-94bc-4464-bbff-e92836026cf8).

## Per-cluster operation order (safe clusters)

1. repoint aliases.canonical_id -> survivor
2. repoint company_mentions.company_id -> survivor
3. repoint financial_facts.company_id -> survivor (usually 0 rows; dups lack a cik)
4. repoint insider_transactions.company_id -> survivor
5. repoint resolution_log.resolved_canonical_id -> survivor
6. repoint sec_filings.company_id -> survivor
7. fold mention_count onto survivor
8. backfill survivor ticker+cik (COALESCE; only fills nulls)
9. DELETE retired duplicate rows
All nine inside one BEGIN/COMMIT per cluster.

## Rollback considerations

- Each cluster is one transaction: a failure rolls the whole cluster back.
- Repoints are reversible only by knowing the prior fk values; capture them
  first if you want a manual undo (SELECT ... WHERE fk IN (dups) before each
  block). The DELETE is the irreversible step; run a backup/export of the
  retired rows first.
- mention_count fold is not independently idempotent; rely on the per-cluster
  transaction (after a committed cluster the dups are gone, so a re-run is a
  no-op).

## Single-cluster dry-run harness (observe deltas, commit nothing)

Wrap one cluster block in a transaction and ROLLBACK to see row counts move
without persisting:
```sql
BEGIN;
-- paste ONE cluster's repoint+fold+backfill+delete statements here
-- then inspect, e.g.:
SELECT 'mentions_on_survivor' AS k, count(*) FROM company_mentions WHERE company_id = '<survivor>';
SELECT 'survivor_row' AS k, id, ticker, sec_cik, mention_count FROM companies WHERE id = '<survivor>';
SELECT 'retired_still_present' AS k, count(*) FROM companies WHERE id IN (<dups>);
ROLLBACK;  -- nothing is committed
```

## Quarantined clusters (bucket C, manual review)

| cik | reason | members (name / ticker / cik) |
|---|---|---|
| 2488 | two or more already-populated rows (pop-vs-pop) | Advanced Micro Devices Inc (t=None, cik=None); Advanced Micro Devices Inc. (t=AMD, cik=2488); Advanced Micro (t=AMD, cik=2488); AMD (t=AMD, cik=2488); Advanced Micro Devices (t=AMD, cik=2488); Advanced Micro Devices, Inc. (t=AMD, cik=2488) |
| 4962 | two or more already-populated rows (pop-vs-pop) | American Express Company (t=None, cik=None); American Express Co. (t=None, cik=None); American Express Co (t=None, cik=None); American Express (t=None, cik=None); Express (t=AXP, cik=4962); American (t=AXP, cik=4962) |
| 21665 | two or more already-populated rows (pop-vs-pop) | Colgate Palmolive (t=None, cik=None); Colgate-Palmolive (t=CL, cik=21665); LG (t=CL, cik=21665) |
| 27904 | two or more already-populated rows (pop-vs-pop) | Delta Air Lines Inc (t=None, cik=None); Delta (t=DAL, cik=27904); Delta Air Lines (t=DAL, cik=27904) |
| 34088 | two or more already-populated rows (pop-vs-pop) | Exxon Mobil Corp (t=None, cik=None); Exxon Mobil Corporation (t=XOM, cik=34088); Exxon (t=XOM, cik=34088); Exxon Mobil (t=XOM, cik=34088) |
| 37996 | two or more already-populated rows (pop-vs-pop) | Ford Motor Co (t=None, cik=None); Ford Motor Company (t=None, cik=None); Ford Motor (t=F, cik=37996); Ford (t=F, cik=37996) |
| 45012 | two or more already-populated rows (pop-vs-pop) | Halliburton (t=None, cik=None); Halliburton Company (t=None, cik=None); Halliburton Co (t=None, cik=None); Halliburton Co. (t=HAL, cik=45012); HAL (t=HAL, cik=45012) |
| 51143 | two or more already-populated rows (pop-vs-pop) | International Business Machines (t=None, cik=None); International Business Machines Corp (t=None, cik=None); US (t=IBM, cik=51143); Mach (t=IBM, cik=51143); IBM (t=IBM, cik=51143) |
| 59478 | two or more already-populated rows (pop-vs-pop) | Eli Lilly & Co (t=None, cik=None); Eli Lilly & Co. (t=None, cik=None); Eli Lilly and Company (t=LLY, cik=59478); Eli Lilly (t=LLY, cik=59478) |
| 76334 | two or more already-populated rows (pop-vs-pop) | Parker Hannifin (t=None, cik=None); Parker Hannifin Corp (t=None, cik=None); Parker-Hannifin Corporation (t=None, cik=None); Parker-Hannifin (t=PH, cik=76334); ARK (t=PH, cik=76334) |
| 77476 | two or more already-populated rows (pop-vs-pop) | PepsiCo, Inc. (t=None, cik=None); PepsiCo Inc (t=None, cik=None); PepsiCo Inc. (t=None, cik=None); PepsiCo (t=PEP, cik=77476); Pepsi (t=PEP, cik=77476) |
| 93410 | two or more already-populated rows (pop-vs-pop) | Chevron Corp (t=None, cik=None); Chevron Corporation (t=CVX, cik=93410); Chevron (t=CVX, cik=93410) |
| 100885 | two or more already-populated rows (pop-vs-pop) | Union Pacific Corp. (t=None, cik=None); Union Pacific Corp (t=None, cik=None); Union Pacific (t=UNP, cik=100885); Union Pacific Corporation (t=UNP, cik=100885) |
| 101829 | two or more already-populated rows (pop-vs-pop) | RTX Corp. (t=None, cik=None); RTX Corp (t=RTX, cik=101829); RTX Corporation (t=RTX, cik=101829); Raytheon (t=RTX, cik=101829); RTX (t=RTX, cik=101829) |
| 106040 | two or more already-populated rows (pop-vs-pop) | Western Digital Corporation (t=None, cik=None); Western Digital Corp (t=None, cik=None); Western Digital Corp. (t=WDC, cik=106040); Western Digital (t=WDC, cik=106040) |
| 310764 | two or more already-populated rows (pop-vs-pop) | Stryker Corp (t=None, cik=None); Stryker Corporation (t=None, cik=None); Stryker (t=SYK, cik=310764); Stryker Corp. (t=SYK, cik=310764) |
| 315189 | two or more already-populated rows (pop-vs-pop) | Deere & Co. (t=None, cik=None); Deere & Company (t=DE, cik=315189); Deere (t=DE, cik=315189) |
| 702165 | two or more already-populated rows (pop-vs-pop) | Norfolk Southern Corp (t=None, cik=None); Norfolk Southern Corp. (t=None, cik=None); Norfolk Southern Corporation (t=NSC, cik=702165); Norfolk Southern (t=NSC, cik=702165) |
| 707549 | two or more already-populated rows (pop-vs-pop) | Lam Research Corporation (t=None, cik=None); Lam Research Corp (t=None, cik=None); Lam Research Corp. (t=LRCX, cik=707549); Lam Research (t=LRCX, cik=707549) |
| 723125 | two or more already-populated rows (pop-vs-pop) | Micron Technology Inc (t=None, cik=None); Micron (t=MU, cik=723125); Micron Technology Inc. (t=MU, cik=723125); Micron Technology, Inc. (t=MU, cik=723125); Micron Technology (t=MU, cik=723125) |
| 731766 | two or more already-populated rows (pop-vs-pop) | UnitedHealth Group Inc. (t=None, cik=None); Uni (t=UNH, cik=731766); United (t=UNH, cik=731766); UnitedHealth Group (t=UNH, cik=731766); UnitedHealth (t=UNH, cik=731766) |
| 749251 | two or more already-populated rows (pop-vs-pop) | Gartner Inc (t=None, cik=None); Gartner Inc. (t=None, cik=None); Gartner, Inc. (t=IT, cik=749251); Gartner (t=IT, cik=749251) |
| 789019 | two or more already-populated rows (pop-vs-pop) | Microsoft Corporation (t=None, cik=None); Microsoft Corp (t=None, cik=None); MSFT (t=MSFT, cik=789019); Microsoft Corp. (t=MSFT, cik=789019); Microsoft (t=MSFT, cik=789019) |
| 796343 | two or more already-populated rows (pop-vs-pop) | Adobe Inc (t=None, cik=None); Adobe Inc. (t=ADBE, cik=796343); Adobe (t=ADBE, cik=796343) |
| 831259 | two or more already-populated rows (pop-vs-pop) | Freeport-McMoRan Inc (t=None, cik=None); Freeport McMoRan (t=None, cik=None); Freeport-McMoRan Inc. (t=FCX, cik=831259); Freeport-McMoRan (t=FCX, cik=831259) |
| 885725 | two or more already-populated rows (pop-vs-pop) | Boston Scientific Corp (t=None, cik=None); Boston Scientific Corporation (t=BSX, cik=885725); Boston Scientific (t=BSX, cik=885725) |
| 886982 | two or more already-populated rows (pop-vs-pop) | Goldman Sachs International (t=None, cik=None); The Goldman Sachs Group, Inc. (t=None, cik=None); Goldman Sachs Group (t=None, cik=None); The Goldman Sachs Group (t=None, cik=None); Goldman Sachs Group Inc. (t=GS, cik=886982); Goldman (t=GS, cik=886982); Goldman Sachs (t=GS, cik=886982) |
| 927653 | two or more already-populated rows (pop-vs-pop) | Mckesson Corp (t=None, cik=None); McKesson (t=MCK, cik=927653); McKesson Corporation (t=MCK, cik=927653) |
| 936468 | two or more already-populated rows (pop-vs-pop) | Lockheed Martin Corporation (t=None, cik=None); Lockheed Martin Corp (t=None, cik=None); Lockheed Martin Corp. (t=LMT, cik=936468); Lockheed Martin (t=LMT, cik=936468); Lockheed (t=LMT, cik=936468) |
| 1018724 | two or more already-populated rows (pop-vs-pop) | Amazon.com, Inc. (t=None, cik=None); Amazon.com Inc (t=None, cik=None); Amazon.com Inc. (t=AMZN, cik=1018724); Amazon.com (t=AMZN, cik=1018724); Amazon (t=AMZN, cik=1018724) |
| 1046179 | two or more already-populated rows (pop-vs-pop) | Taiwan Semiconductor Manufacturing Co Ltd (t=None, cik=None); Taiwan Semiconductor Manufacturing (t=TSM, cik=1046179); Taiwan Semiconductor Manufacturing Company (t=TSM, cik=1046179); Taiwan Semiconductor Manufacturing Company Limited (TSM) (t=TSM, cik=1046179); Taiwan Semiconductor Manufacturing Company Limited (t=TSM, cik=1046179); Taiwan Semiconductor Manufacturing Co. (t=TSM, cik=1046179); Taiwan Semiconductor (t=TSM, cik=1046179) |
| 1050446 | two or more already-populated rows (pop-vs-pop) | Strategy Inc. (t=None, cik=None); Strategy Inc (t=None, cik=None); Strategy (t=MSTR, cik=1050446); MSTR (t=MSTR, cik=1050446) |
| 1051627 | two or more already-populated rows (pop-vs-pop) | AXT (t=None, cik=None); AXTI (t=AXTI, cik=1051627); AXT Inc (t=AXTI, cik=1051627) |
| 1065088 | two or more already-populated rows (pop-vs-pop) | eBay Inc (t=None, cik=None); EBay Inc. (t=EBAY, cik=1065088); EBay (t=EBAY, cik=1065088); eBay Inc. (t=EBAY, cik=1065088); eBay (t=EBAY, cik=1065088) |
| 1075531 | two or more already-populated rows (pop-vs-pop) | Booking Holdings Inc. (t=None, cik=None); Booking Holdings Inc (t=None, cik=None); Booking Holdings (t=BKNG, cik=1075531); Booking (t=BKNG, cik=1075531) |
| 1101239 | two or more already-populated rows (pop-vs-pop) | Equinix, Inc. (t=None, cik=None); Equinix Inc. (t=EQIX, cik=1101239); Equinix (t=EQIX, cik=1101239) |
| 1108524 | two or more already-populated rows (pop-vs-pop) | Salesforce Inc (t=None, cik=None); Salesforce (t=CRM, cik=1108524); Salesforce Inc. (t=CRM, cik=1108524) |
| 1120193 | two or more already-populated rows (pop-vs-pop) | Nasdaq Inc (t=None, cik=None); Nasdaq Inc. (t=None, cik=None); Nasdaq (t=NDAQ, cik=1120193); Nasdaq, Inc. (t=NDAQ, cik=1120193) |
| 1137789 | two or more already-populated rows (pop-vs-pop) | Seagate Technology Holdings (t=None, cik=None); Seagate (t=STX, cik=1137789); Seagate Technology (t=STX, cik=1137789) |
| 1163165 | two or more already-populated rows (pop-vs-pop) | ConocoPhillips Company (t=None, cik=None); ConocoPhillips (t=COP, cik=1163165); COP (t=COP, cik=1163165) |
| 1176948 | two or more already-populated rows (pop-vs-pop) | Ares Management Corporation (t=None, cik=None); Ares Management Corp (t=None, cik=None); Ares Management (t=ARES, cik=1176948); Ares (t=ARES, cik=1176948) |
| 1260221 | two or more already-populated rows (pop-vs-pop) | TransDigm Group Inc (t=None, cik=None); TransDigm Group Inc. (t=None, cik=None); TransDigm Group Incorporated (t=TDG, cik=1260221); TransDigm (t=TDG, cik=1260221); TransDigm Group (t=TDG, cik=1260221) |
| 1315098 | two or more already-populated rows (pop-vs-pop) | Roblox Corporation (t=None, cik=None); Roblox Corp. (t=RBLX, cik=1315098); Roblox (t=RBLX, cik=1315098) |
| 1326801 | two or more already-populated rows (pop-vs-pop) | Meta Platforms Inc (t=None, cik=None); Meta Platforms (t=META, cik=1326801); Meta Platforms Inc. (t=META, cik=1326801); Meta Platforms, Inc. (t=META, cik=1326801); Meta (t=META, cik=1326801) |
| 1373715 | two or more already-populated rows (pop-vs-pop) | ServiceNow Inc (t=None, cik=None); ServiceNow Inc. (t=NOW, cik=1373715); ServiceNow (t=NOW, cik=1373715); ServiceNow, Inc. (t=NOW, cik=1373715) |
| 1375365 | two or more already-populated rows (pop-vs-pop) | Super Micro Computer Inc (t=None, cik=None); Super Micro Computer, Inc. (t=SMCI, cik=1375365); Super Micro Computer Inc. (t=SMCI, cik=1375365); Super Micro (t=SMCI, cik=1375365); SMCI (t=SMCI, cik=1375365); Super Micro Computer (t=SMCI, cik=1375365) |
| 1375877 | two or more already-populated rows (pop-vs-pop) | Canadian Solar Inc (t=None, cik=None); Canadian Solar Inc. (t=CSIQ, cik=1375877); Canadian Solar (t=CSIQ, cik=1375877) |
| 1393818 | two or more already-populated rows (pop-vs-pop) | BLACKSTONE INC (t=None, cik=None); Blackstone Inc. (t=BX, cik=1393818); BX (t=BX, cik=1393818); Blackstone (t=BX, cik=1393818) |
| 1397187 | two or more already-populated rows (pop-vs-pop) | Lululemon Athletica Inc (t=None, cik=None); lululemon athletica inc. (t=None, cik=None); Lululemon (t=LULU, cik=1397187); lululemon athletica (t=LULU, cik=1397187) |
| 1428439 | two or more already-populated rows (pop-vs-pop) | ROKU, INC. (t=None, cik=None); Roku Inc. (t=ROKU, cik=1428439); Roku (t=ROKU, cik=1428439) |
| 1437107 | two or more already-populated rows (pop-vs-pop) | Warner Bros Discovery (t=None, cik=None); Warner Bros. Discovery Inc. (t=None, cik=None); Warner Bros. (t=WBD, cik=1437107); Warner Bros (t=WBD, cik=1437107); Warner Bros. Discovery (t=WBD, cik=1437107); Cove (t=WBD, cik=1437107); WBD (t=WBD, cik=1437107) |
| 1501585 | two or more already-populated rows (pop-vs-pop) | Huntington Ingalls Industries (t=None, cik=None); NGA (t=HII, cik=1501585); Huntington Ingalls (t=HII, cik=1501585) |
| 1513761 | two or more already-populated rows (pop-vs-pop) | Norwegian Cruise Line Holdings Ltd. (t=None, cik=None); Norwegian Cruise Line Holdings Ltd (t=None, cik=None); Norwegian Cruise Line (t=NCLH, cik=1513761); Norwegian Cruise (t=NCLH, cik=1513761); Norwegian Cruise Line Holdings (t=NCLH, cik=1513761) |
| 1517413 | two or more already-populated rows (pop-vs-pop) | Fastly, Inc. (t=None, cik=None); Fastly Inc. (t=FSLY, cik=1517413); Fastly (t=FSLY, cik=1517413) |
| 1535527 | two or more already-populated rows (pop-vs-pop) | CrowdStrike Holdings (t=None, cik=None); KE Holdings Inc. (t=CRWD, cik=1535527); CrowdStrike (t=CRWD, cik=1535527) |
| 1543151 | two or more already-populated rows (pop-vs-pop) | Uber Technologies Inc (t=None, cik=None); Uber Technologies, Inc. (t=None, cik=None); Uber Technologies Inc. (t=UBER, cik=1543151); Uber Technologies (t=UBER, cik=1543151); Uber (t=UBER, cik=1543151) |
| 1551152 | two or more already-populated rows (pop-vs-pop) | AbbVie Inc. (t=None, cik=None); ABBV (t=ABBV, cik=1551152); AbbVie (t=ABBV, cik=1551152) |
| 1564408 | two or more already-populated rows (pop-vs-pop) | Snap Inc (t=None, cik=None); Snap, Inc. (t=SNAP, cik=1564408); Snap Inc. (t=SNAP, cik=1564408); Snap (t=SNAP, cik=1564408) |
| 1571996 | two or more already-populated rows (pop-vs-pop) | Dell Technologies Inc (t=None, cik=None); Dell Tech (t=DELL, cik=1571996); Dell Technologies Inc. (t=DELL, cik=1571996); Dell Technologies (t=DELL, cik=1571996); Dell (t=DELL, cik=1571996) |
| 1577552 | two or more already-populated rows (pop-vs-pop) | Alibaba Group Holding Ltd (t=None, cik=None); Alibaba Group Holdings Ltd. (t=None, cik=None); Alibaba Group Holding Limited (t=None, cik=None); Alibaba Group Holding Ltd. (t=BABA, cik=1577552); Alibaba Group (t=BABA, cik=1577552); Alibaba (t=BABA, cik=1577552) |
| 1590364 | two or more already-populated rows (pop-vs-pop) | FTAI Aviation Ltd. (t=None, cik=None); FTAI Aviation Ltd (t=None, cik=None); Fortress (t=FTAI, cik=1590364); FTAI Aviation (t=FTAI, cik=1590364) |
| 1594805 | two or more already-populated rows (pop-vs-pop) | Shopify Inc (t=None, cik=None); Shopify Inc. (t=SHOP, cik=1594805); Shopify (t=SHOP, cik=1594805) |
| 1628171 | two or more already-populated rows (pop-vs-pop) | Revolution Medicines Inc. (t=None, cik=None); Revolution Medicines (t=None, cik=None); Revolut (t=RVMD, cik=1628171); Revolut Ltd. (t=RVMD, cik=1628171) |
| 1633978 | two or more already-populated rows (pop-vs-pop) | Lumentum Holdings (t=None, cik=None); Lumentum Holdings Inc (t=None, cik=None); Lumentum Holdings Inc. (t=LITE, cik=1633978); Lumentum (t=LITE, cik=1633978) |
| 1639920 | two or more already-populated rows (pop-vs-pop) | Spotify Technology S.A. (t=None, cik=None); Spotify Technology SA (t=SPOT, cik=1639920); Spotify (t=SPOT, cik=1639920) |
| 1645590 | two or more already-populated rows (pop-vs-pop) | Hewlett Packard Enterprise Co. (t=None, cik=None); Hewlett Packard Enterprise Company (t=None, cik=None); Hewlett Packard Enterprise (t=HPE, cik=1645590); HPE (t=HPE, cik=1645590) |
| 1653909 | two or more already-populated rows (pop-vs-pop) | Allbirds, Inc. (t=None, cik=None); Allbirds (t=BIRD, cik=1653909); Bird (t=BIRD, cik=1653909) |
| 1664703 | two or more already-populated rows (pop-vs-pop) | Bloom Energy Corporation (t=None, cik=None); Bloom Energy Corp (t=None, cik=None); Bloom Energy Corp. (t=BE, cik=1664703); Bloom Energy (t=BE, cik=1664703) |
| 1713445 | two or more already-populated rows (pop-vs-pop) | Reddit Inc. (t=None, cik=None); Reddit (t=RDDT, cik=1713445); Reddit Inc (t=RDDT, cik=1713445); Reddit, Inc. (t=RDDT, cik=1713445) |
| 1730168 | two or more already-populated rows (pop-vs-pop) | Broadcom Inc (t=None, cik=None); Broadcom Inc. (t=AVGO, cik=1730168); Broadcom (t=AVGO, cik=1730168) |
| 1736541 | two or more already-populated rows (pop-vs-pop) | NIO Inc. (t=None, cik=None); Nio (t=NIO, cik=1736541); NIO (t=NIO, cik=1736541) |
| 1744489 | two or more already-populated rows (pop-vs-pop) | Walt Disney (t=None, cik=None); Walt Disney Co (t=None, cik=None); Walt Disney Co. (t=DIS, cik=1744489); Walt Disney Company (t=DIS, cik=1744489); Disney (t=DIS, cik=1744489) |
| 1759509 | two or more already-populated rows (pop-vs-pop) | Lyft, Inc. (t=None, cik=None); Lyft Inc. (t=LYFT, cik=1759509); Lyft (t=LYFT, cik=1759509) |
| 1792789 | two or more already-populated rows (pop-vs-pop) | DoorDash Inc (t=None, cik=None); DoorDash, Inc. (t=None, cik=None); DoorDash Inc. (t=DASH, cik=1792789); DoorDash (t=DASH, cik=1792789) |
| 1811210 | two or more already-populated rows (pop-vs-pop) | Lucid Group, Inc. (t=None, cik=None); Lucid Group (t=LCID, cik=1811210); Lucid (t=LCID, cik=1811210) |
| 1834584 | two or more already-populated rows (pop-vs-pop) | Coupang, Inc. (t=None, cik=None); Coupang Inc (t=None, cik=None); Coupang (t=CPNG, cik=1834584); Coupang Inc. (t=CPNG, cik=1834584) |
| 1835632 | two or more already-populated rows (pop-vs-pop) | Marvell Technology Inc (t=None, cik=None); Marvell Technology, Inc. (t=None, cik=None); Marvell Technology Inc. (t=MRVL, cik=1835632); Marvell (t=MRVL, cik=1835632); Marvell Technology (t=MRVL, cik=1835632) |
| 1840856 | two or more already-populated rows (pop-vs-pop) | SoundHound AI, Inc. (t=None, cik=None); SoundHound AI (t=SOUN, cik=1840856); SoundHound AI Inc (t=SOUN, cik=1840856); SoundHound (t=SOUN, cik=1840856) |
| 1855612 | two or more already-populated rows (pop-vs-pop) | Grab Holdings Limited (t=None, cik=None); Grab Holdings (t=None, cik=None); Grab Holdings Ltd. (t=GRAB, cik=1855612); Grab (t=GRAB, cik=1855612) |
| 1858681 | two or more already-populated rows (pop-vs-pop) | Apollo Global Management Inc. (t=None, cik=None); Apollo Global Management (t=None, cik=None); Apollo Global (t=APO, cik=1858681); Apollo (t=APO, cik=1858681) |
| 1932393 | two or more already-populated rows (pop-vs-pop) | GE Healthcare Technologies Inc (t=None, cik=None); GE HealthCare Technologies (t=None, cik=None); GE HealthCare Technologies Inc. (t=None, cik=None); GE HealthCare (t=GEHC, cik=1932393); GE Healthcare (t=GEHC, cik=1932393) |
| 1969302 | two or more already-populated rows (pop-vs-pop) | Pony.ai (t=None, cik=None); Pony AI (t=PONY, cik=1969302); Pony AI Inc. (t=PONY, cik=1969302) |
| 2023554 | two or more already-populated rows (pop-vs-pop) | SanDisk Corporation (t=None, cik=None); Sandisk Corp. (t=SNDK, cik=2023554); SanDisk (t=SNDK, cik=2023554); Sandisk (t=SNDK, cik=2023554) |
| 2041610 | two or more already-populated rows (pop-vs-pop) | Paramount-Skydance (t=None, cik=None); Skydance (t=PSKY, cik=2041610); Paramount Skydance Corp. (t=PSKY, cik=2041610); Paramount Skydance Corp (t=PSKY, cik=2041610); Paramount Skydance (t=PSKY, cik=2041610); Paramount (t=PSKY, cik=2041610) |
| 2052959 | two or more already-populated rows (pop-vs-pop) | Lionsgate Studios (t=None, cik=None); Lionsgate Studios Corp. (t=LION, cik=2052959); Lionsgate (t=LION, cik=2052959) |
| 2062440 | two or more already-populated rows (pop-vs-pop) | KYIVSTAR GROUP (t=None, cik=None); Kyivstar Group Ltd. (t=KYIV, cik=2062440); Kyivstar (t=KYIV, cik=2062440) |
