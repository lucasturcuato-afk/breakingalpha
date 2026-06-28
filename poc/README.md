# Web-memo anti-fabrication POCs (isolated, not wired into product)

Standalone scripts that test the anti-fabrication hypotheses in
`docs/recon/webmemo-antifab-plan.md` against REAL Exa pools. Nothing here is
imported by the app. Read-only: the only external calls are Exa `/search`
fetches (product params); no Supabase writes, no flag changes.

## Files
- `fetch-pool.mjs` — replicates the product Exa path (`src/lib/web-search.ts`
  `fetchExa` + `dedupe`, `web-fallback` route's `${q} company news` + limit 8) to
  pull a real pool. Reads `EXA_API_KEY` from the main repo `.env.local` (never
  printed). Usage: `node poc/fetch-pool.mjs "Klaviyo" kvyo`
- `pools/*.json` — captured real pools (kvyo, lakeshore, richtech, unum),
  fetched 2026-06-28.
- `kvyo-memo-fixture.json` — the 8 ground-truth KVYO claims (4 fabricated + 4
  true), citation-decorated and traced to real pool indices.
- `gates-deterministic.mjs` — baseline (prod guards copied import-free) + H2
  (cross-source corroboration) + H4 (causal fence), pure code, per-claim
  catch/miss. Usage: `node poc/gates-deterministic.mjs`
- H1 (entailment) and H3 (extract-then-generate) were run via a Claude subagent
  as the gemini-2.5-flash stand-in over `pools/kvyo.json`; results are recorded in
  the plan doc. Production eval must re-run these against real gemini-2.5-flash.

## Reproduce
```
node poc/fetch-pool.mjs "Klaviyo" kvyo
node poc/gates-deterministic.mjs
```

Note: Exa's 30-day window is relative to now, so re-fetched pools drift from the
pool the live memo used (see the c1 / t4 caveats in the plan doc).
