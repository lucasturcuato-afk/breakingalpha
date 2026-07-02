# Thin-news graceful-degradation fallback

When the web-memo thin-pool gate fires (too few on-entity news sources), do NOT
generate a news thesis. Instead surface the richest available PRIMARY-SOURCE
data, degrading by DATA PRESENCE, ending in an honest no-coverage state. Behind a
default-OFF flag (`NEXT_PUBLIC_THIN_FALLBACK_ENABLED`). No model narration.

## Tiers (chosen by real data presence)

| Tier | Condition | Renders |
|---|---|---|
| A | XBRL financials exist | Financial snapshot (rev/margin/EPS) + recent SEC filings |
| B | CIK + filings, no XBRL | Recent SEC filings only |
| C | CIK but no data, OR no CIK | Honest suppress state |

Tier decision is pure and unit-tested (`src/lib/thin-fallback-tier.ts`,
`tests/unit/thin-fallback-tier.test.ts`, 5/5):
```
export function selectTier(xbrlPresent, filingsCount, cik) {
  if (xbrlPresent) return "A";
  if (cik != null && filingsCount > 0) return "B";
  return "C";
}
```

The three presence checks key on the same tables the Financials/Filings tabs use:
- `xbrlPresent` = `fetchCompanyFinancials` returned >= 1 XBRL period (queries
  `financial_facts_latest` by `cik`).
- `filingsCount` = `fetchCompanyFilings` rows (queries `sec_filings` by `cik`).
- `cik` = `resolveCompanyCik` -> `companies.sec_cik` (null for private / pre-CIK
  on-demand mints).

## Compliance / anti-fabrication

- Financials and filings are DISPLAYED FROM STRUCTURED DATA. The model narrates
  nothing: no interpretation of an 8-K, no "results were strong", no
  directional/valuation/buy-sell language. There is NO LLM call on this path.
- The model-written `sec_filings.summary` column is deliberately dropped from the
  `ThinFallbackFiling` shape; filing rows show date + form-type + document link
  only. So there is no generated prose to compliance-filter (pure display).
- A disclaimer renders on the surface: "Primary-source data shown as filed with
  the SEC. Informational only, not investment advice."

## Sample renders (real data, read-only; `recon/thin-fallback-harness.ts`)

TIER A (UNM, 799 XBRL fact rows in `financial_facts_latest`):
```
DATA PRESENCE -> xbrlPresent=true (fact rows=799), filings=0, cik=true  >>> TIER A
  Financial snapshot (FY2025)
    Revenue            $13.08B
    Net income         $738.5M
    EPS (diluted)      $4.27
    Net margin         5.6%
```

TIER A with filings (AMD, cik=2488, has both XBRL and sec_filings rows):
```
FULL TIER A -> tier A
  RENDERED filings (date | form | doc), NO model summary:
    2026-07-01  8-K      [View]
    2026-06-17  4        [View]
    2026-06-12  4        [View]
```

TIER C (no `sec_cik` in `companies`, e.g. an on-demand-minted name):
```
companies.sec_cik = null
DATA PRESENCE -> xbrlPresent=false, filings=0, cik=false  >>> TIER C
  "No recent news coverage and no SEC data available for this company yet."
```
(Also verified for an unknown name with no companies row -> Tier C.)

Harness caveat: the harness resolves the company by a naive `ilike` on the raw
name, so display-name mismatches (e.g. "Apple Inc" vs the stored canonical) fall
to Tier C in the harness; the product route resolves via `resolveCompanyCik`
(canonicalized), matching more names. Tier A is demonstrated on UNM/AMD, which
resolve exactly.

## Wiring + flag

- New route `POST /api/companies/thin-fallback` (read-only; 503 when flag off,
  401 unauthenticated; service client reads reference tables).
- `PrimerThinFallback.tsx` self-fetches and renders the tier; reuses
  `PrimerFinancialSnapshot` for the Tier A financials block.
- `PrimerWebMemo.tsx` renders `<PrimerThinFallback>` only when
  `thin && NEXT_PUBLIC_THIN_FALLBACK_ENABLED === "true"` (default off), so
  behavior is unchanged until the flag is flipped.

## Gates
tsc 0, eslint 0, build success, unit 5/5. No protected files touched. No prod
write, no memo generation, no flag flip.
