# BEA Data Layer Recon

Recon for `backend/bea_calendar.py`, the BEA sibling of the merged BLS layer
(`backend/macro_calendar.py`). Adds PCE, core PCE, and real GDP to the macro data set,
same `MacroRelease`/`MacroFigure` output shape, different source API. Data-layer only.

- Date: 2026-06-14
- Branch: `feat/bea-data-layer` off `origin/main` (e32d5a96, the BLS-layer merge #357)
- Live recon ran against the BEA API with `BEA_API_KEY` set. Read-only GETs only.
- API key hygiene: the key is never written to any committed file. BEA echoes `USERID` in the
  response `Request` block, so it is redacted to `SCRUBBED` in every saved fixture; fixtures were
  asserted key-free before saving.

## API

- GET `https://apps.bea.gov/api/data/` with a params dict:
  `UserID=<env BEA_API_KEY>, method=GetData, datasetname=NIPA, TableName, Frequency, Year, ResultFormat=JSON`.
- `Year` accepts a comma list; we send the trailing 3 calendar years (e.g. `2024,2025,2026`).
  Confirmed live this returns full monthly/quarterly history for that window.
- Response: `BEAAPI.Results.Data[]` rows of `{TableName, SeriesCode, LineNumber, LineDescription,
  TimePeriod, METRIC_NAME, CL_UNIT, UNIT_MULT, DataValue, NoteRef}`. `TimePeriod` is `YYYYMNN`
  (monthly) or `YYYYQN` (quarterly). `BEAAPI.Results.Notes[]` carries `NoteText` with a
  `LastRevised: <date>` string (the release vintage).

## Row enumeration (live) and exact identifiers chosen

### T20807, Frequency=M (Table 2.8.7, m/m percent change in PCE prices) -- 31 lines

| Use | Line | SeriesCode | LineDescription | latest (2026M04) |
|---|---|---|---|---|
| **Headline PCE m/m** | L1 | `DPCERGM` | Personal consumption expenditures (PCE) | 0.4 |
| **Core PCE m/m** | L25 | `DPCCRGM` | PCE excluding food and energy | 0.2 |
| decoy (excluded) | L30 | `DPCMRGM` | Market-based PCE | 0.5 |
| decoy (excluded) | L31 | `DPCXRGM` | Market-based PCE excluding food and energy | 0.3 |

### T20804, Frequency=M (Table 2.8.4, PCE price index LEVELS) -- 31 lines

| Use | Line | SeriesCode | LineDescription | latest (2026M04) |
|---|---|---|---|---|
| **Headline PCE level** | L1 | `DPCERG` | Personal consumption expenditures (PCE) | 130.902 |
| **Core PCE level** | L25 | `DPCCRG` | PCE excluding food and energy | 129.630 |
| decoy (excluded) | L30 | `DPCMRG` | Market-based PCE | 128.532 |
| decoy (excluded) | L31 | `DPCXRG` | Market-based PCE excluding food and energy | 126.700 |

### T10101, Frequency=Q (Table 1.1.1, percent change in real GDP) -- 25 lines

| Use | Line | SeriesCode | LineDescription | latest (2026Q1) |
|---|---|---|---|---|
| **Real GDP q/q annualized** | L1 | `A191RL` | Gross domestic product | 1.6 |
| (not used; quarterly PCE trap) | L2 | `DPCERL` | Personal consumption expenditures | 1.4 |

## Market-based decoy: explicitly excluded

Core PCE is **L25 `DPCCRGM` / `DPCCRG`** ("PCE excluding food and energy"). The decoys are
**L30** ("Market-based PCE") and **L31** ("Market-based PCE excluding food and energy"), series
codes `DPCM...` and `DPCX...`. The builder selects strictly by the headline (`DPCER...`) and core
(`DPCC...`) series codes; the market-based lines are never selected. A unit test asserts the
selected core code is `DPCCRGM`/`DPCCRG` and is NOT `DPCXRGM`/`DPCXRG`.

## Monthly vs quarterly guard

The PCE panel figures are sourced ONLY from the monthly tables T20807 (m/m) and T20804 (levels).
The quarterly table T10101 contains a quarterly PCE series (L2 `DPCERL`) which is the
quarterly-PCE trap; it is never used for the PCE panel. T10101 is used only for real GDP (L1).

## y/y construction (verified against published anchors)

y/y is not published in T20807; it is computed from the T20804 index LEVELS as
`(Index[m] / Index[m-12] - 1) * 100`, with no rounding of the index before the division and the
final percentage rounded to 1 decimal. Live verification reproduced the published anchors exactly:

| Figure | m/m (T20807) | y/y (computed from T20804 levels) | prior month |
|---|---|---|---|
| Headline PCE, April 2026 | 0.4 | (130.902 / 126.150 - 1) x 100 = **3.8** | m/m 0.7, y/y 3.5 |
| Core PCE, April 2026 | 0.2 | (129.630 / 125.502 - 1) x 100 = **3.3** | m/m 0.3, y/y 3.2 |
| Real GDP, Q1 2026 | n/a | A191RL = **1.6** (q/q annualized), prior quarter 2025Q4 = 0.5 | LastRevised May 28, 2026 |

These match the mid-June 2026 anchors (PCE m/m +0.4 / y/y +3.8; core m/m +0.2 / y/y +3.3;
real GDP Q1 second estimate +1.6) to the decimal, confirming the row selection and the
levels-based y/y method.

## Robustness notes (carried into the build)

- `DataValue` may carry commas; strip before float parse. Negatives appear (GDP components show
  e.g. `-5.4`), so parsing must handle them.
- 12-month-prior level may be missing (2025 data gaps): omit the y/y figure rather than computing
  against a wrong month. Prior selection uses exact calendar lookups (month-1 / quarter-1), so a
  gap yields a missing prior rather than a gapped neighbor.
- GDP vintage is surfaced from `Results.Notes[].NoteText` (`LastRevised: ...`).

## Confidence

All BEA identifiers used are marked **confirmed**: the row selection was verified live and the
values match the published anchors to the decimal. (y/y is a documented computation from published
levels, not an invented number.)

## Fixtures saved (key-scrubbed)

`backend/tests/fixtures/bea_T20807_M.json`, `bea_T20804_M.json`, `bea_T10101_Q.json`. To keep them
reviewable, `Results.Data` was filtered to the consumed + decoy lines (PCE tables: L1/L25/L30/L31;
GDP table: L1/L2) with the FULL time history for those lines retained; everything else in the
response shape is preserved verbatim. `USERID` redacted to `SCRUBBED`. No key string is present in
any fixture (asserted).
