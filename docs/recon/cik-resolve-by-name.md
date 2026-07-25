# CIK resolution by full company name

`resolveCompanyCik` resolved tickers and short canonical names but failed on full
company names, so the thin-fallback wrongly showed Tier C (no data) for companies
that have XBRL + filings.

## Root cause (confirmed against real data): DUPLICATE ROWS + a first-match resolver

The old resolver matched `companies.name` by `ilike(canonicalize(name)).limit(1)`
and returned whatever matched first. But the companies table stores duplicates:
the sec_cik lives on a SHORT canonical / ticker row, while full and legal name
variants exist as SEPARATE rows with `sec_cik = null`.

Real rows (read-only probe):
```
sec_cik 2488 -> {name:"AMD", ticker:"AMD"}
   duplicates: {"Advanced Micro Devices Inc", null}, {"Advanced Micro Devices (AMD)", null}, ...
sec_cik 5513 -> {name:"Unum Group", ticker:"UNM"}       dup: {"Unum", null}
sec_cik 51143 -> {name:"IBM", ticker:"IBM"}             dup: {"International Business Machines", null}
sec_cik 937966 -> {name:"ASML", ticker:"ASML"}
LSBK -> {name:"Lake Shore Bancorp Inc/Md", ticker:"LSBK", sec_cik: null}  (genuinely no CIK)
```

So:
- "Advanced Micro Devices" -> canonicalize misses (stored names carry "Inc"/"(AMD)"), NO MATCH -> Tier C.
- "Unum Group" -> canonicalize collapses to "Unum" -> matched the null-CIK "Unum" DUPLICATE -> Tier C.
- The resolver never consulted the populated `aliases` table (4945 rows) which maps surface_form -> canonical_id.

Which option: (a) AND (b). Stored canonical is a short form so full names miss (a),
and where a full name does match it hits a null-CIK duplicate first (b). Plus (c):
aliases were never consulted. (There is no `cik_tickers` table in this schema.)

## Fix (name -> CIK only; tier logic and render unchanged)

`resolveCompanyCik` now resolves in order, always PREFERRING a row with a sec_cik:
1. exact id
2. exact ticker (`ref.ticker`; the CIK lives on the ticker'd row) - threaded from the thin-fallback route
3. exact name (raw AND canonicalized), `pickPreferCik` so a null-CIK duplicate never shadows the filer row
4. alias match: `aliases.lookup_key -> canonical_id -> companies` (bridges full legal names to the CIK row)
5. fall back to the best non-CIK match so name/companyId are still set and the caller renders an honest Tier C

`pickPreferCik(rows)` returns the first row with a non-null `sec_cik`, else the first row.

One data bridge added to the existing `CANONICAL` map (idiomatic, same as
`"google llc" -> "Alphabet"`): IBM's legal name -> `"IBM"`. IBM's alias row points
to a null-CIK orphan duplicate and no CIK-bearing row exists under the legal name,
so the canonical map is the correct place to link it to the `IBM` filer row.

## Verification (real resolution, `recon/verify.ts`, read-only)

| Input (name only) | Before | After |
|---|---|---|
| Advanced Micro Devices | Tier C (cik null) | **Tier A, cik 2488** |
| AMD | Tier A, cik 2488 | Tier A, cik 2488 (unchanged) |
| Unum Group | Tier C (cik null) | **Tier A, cik 5513** |
| International Business Machines | Tier C (cik null) | **Tier A, cik 51143** |
| ASML Holding | Tier C (cik null) | **Tier A, cik 937966** |
| Lake Shore Bancorp | Tier C | Tier C (correct: LSBK row has sec_cik null) |
| Zzq Nonexistent Holdings | Tier C | Tier C (no false positive) |

No false positives (`recon/verify2.ts`): Anthropic / OpenAI / Stripe -> Tier C
(null). SpaceX -> Tier B, cik 1181412 (its real SEC Reg-D CIK; correct, not a
false positive).

## Gates
tsc 0, eslint 0, `npm run build` success, unit 94/94. No protected files touched.
Read-only; no prod write, no tier-logic or render change.
