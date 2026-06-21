# SEC company reconciliation report (2026-06-21)

Companies scanned: 4238. SEC company_tickers.json entries: 10414.
Name ratio threshold (fuzzy/MEDIUM): 0.6.

| bucket | count | disposition |
|---|---|---|
| Phase A HIGH (auto-backfillable) | 914 | in phase-a.sql, apply after review |
| Phase A MEDIUM (manual review) | 75 | flagged, NOT in sql |
| New-universe SEC companies | 9141 | expansion opportunity, no action |
| Many-to-one collisions | 457 | flagged, adjudicate (dedup) |
| Ambiguous (db -> 2+ SEC) | 18 | flagged, never backfilled |

## Phase A HIGH (sample)

| sec_ticker | our name | SEC title | via | fills | CIK |
|---|---|---|---|---|---|
| AAOI | Applied Optoelectronics Inc | APPLIED OPTOELECTRONICS, INC. | name | ticker+cik | 1158114 |
| AAOI | Applied Optoelectronics | APPLIED OPTOELECTRONICS, INC. | name | ticker+cik | 1158114 |
| AAOI | Applied Optoelectronics, Inc. | APPLIED OPTOELECTRONICS, INC. | name | ticker+cik | 1158114 |
| AAOI | Applied Optoelectronics Inc. | APPLIED OPTOELECTRONICS, INC. | name | ticker+cik | 1158114 |
| AAP | Advance Auto Parts | ADVANCE AUTO PARTS INC | name | ticker+cik | 1158449 |

## Phase A MEDIUM (sample, manual review)

| our name | SEC title | via | ratio | CIK |
|---|---|---|---|---|
| Rigetti | Rigetti Computing, Inc. | ticker | 0.58 | 1838359 |
| Euronet | EURONET WORLDWIDE, INC. | ticker | 0.58 | 1029199 |
| Bain Capital | Bain Capital Specialty Finance, Inc. | ticker | 0.57 | 1655050 |
| Otro | PHOTRONICS INC | ticker | 0.57 | 810136 |
| Factory | CHEESECAKE FACTORY INC | ticker | 0.56 | 887596 |

## New-universe SEC companies (sample)

| sec_ticker | SEC title | CIK |
|---|---|---|
| CYATY | Contemporary Amperex Technology Co., Limited/ADR | 2070829 |
| PG | PROCTER & GAMBLE Co | 80424 |
| HD | HOME DEPOT, INC. | 354950 |
| NVS | NOVARTIS AG | 1114448 |
| KXIAY | Kioxia Holdings Corporation/ADR | 2053383 |

## Many-to-one collisions (sample)

SEC entry matched by 2+ DB companies (applying backfills would create duplicate tickers; dedup decision is human).

| CIK | DB companies (name / ticker / cik) |
|---|---|
| 1410384 | Q2 Holdings, Inc. (t=None, cik=None); Q2 Holdings (t=QTWO, cik=1410384) |
| 1633931 | TopBuild Corp. (t=BLD, cik=1633931); TopBuild Corp (t=None, cik=None); TopBuild (t=None, cik=None) |
| 712515 | Electronic Arts Inc. (t=EA, cik=712515); Electronic Arts (t=EA, cik=712515); EA (t=EA, cik=712515) |
| 77476 | PepsiCo, Inc. (t=None, cik=None); Pepsi (t=PEP, cik=77476); PepsiCo Inc (t=None, cik=None); PepsiCo Inc. (t=None, cik=None); PepsiCo (t=PEP, cik=77476) |
| 906553 | BYD (t=BYD, cik=None); BYD Co. (t=BYD, cik=None) |

## Ambiguous (sample)

| our name | candidate SEC titles |
|---|---|
| BYD | BOYD GAMING CORP (CIK 906553); BYD CO LTD (CIK 1445162) |
| UBS | UBS AG (CIK 1114446); UBS Group AG (CIK 1610520) |
| BYD Co. | BOYD GAMING CORP (CIK 906553); BYD CO LTD (CIK 1445162) |
| Senior | SENIOR PLC (CIK 1329213); Brookdale Senior Living Inc. (CIK 1332349) |
| Rocket | Rocket Companies, Inc. (CIK 1805284); Rocket Lab Corp (CIK 1819994) |
