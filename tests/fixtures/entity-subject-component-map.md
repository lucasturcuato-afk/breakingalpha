# Component map

Every case is tagged with the components it exercises. The floor is three cases per
component. The old fixture could not move two of the five at all.

## The five ablatable components

| component | what it is | cases | positive | negative |
|---|---|---:|---:|---:|
| `nameCompleteness` | `significantTokens` / `identifyingPhrases` / `occurrences`, is the name really present | 238 | 136 | 102 |
| `exchangeStrip` | `stripExchangeQualifiers`, the `(NASDAQ: ABCD)` pattern | 46 | 23 | 23 |
| `D1` | `isRosterElement`, the name is one item in a list | 39 | 10 | 29 |
| `D2` | `isCounterpartyAdjunct`, the name is the other party | 27 | 12 | 15 |
| `D3` | `isAnalystAttributor`, the name is the firm issuing a rating | 61 | 36 | 25 |

## The six promotion rules

| rule | cases | positive | negative |
|---|---:|---:|---:|
| `P0` whole-segment | 11 | 11 | 0 |
| `P1` segment-lead | 93 | 81 | 12 |
| `P2` possessive | 16 | 12 | 4 |
| `P3` action-verb | 41 | 38 | 3 |
| `P4` self-reference-noun | 8 | 7 | 1 |
| `P5` ticker-in-segment | 48 | 43 | 5 |

## Where the cases came from

| section | cases | source |
|---|---:|---|
| A | 68 | known-wrong pairs across all six surfaces, re-derived against prod |
| B | 59 | the 599-pair co-mention holdout, plus fresh rows replacing the self-certifying 34 |
| C | 35 | the cached 2026-06-08 AfterQuery lookup, all twelve results |
| D | 45 | fabricated names, real-name collisions, and near-miss string traps |
| E | 141 | true positives, including ten mandated hard-positive shapes |

**348 cases: 192 positive, 156 negative.**
Positives outnumber negatives, so rejecting everything cannot score well.

Verdicts are three way: 80 ABSENT, 76 MENTION, 192 SUBJECT.
Scope: 76 document, 272 title.
