# On-demand companies-row creation: recon

Read-only investigation. Question: when a user looks up a ticker NOT in the
`companies` table, what would it take to resolve it (Finnhub), insert a minimal
row, and mount the Primer instead of EmptyState. No code, schema, or data was
changed. All file:line refs are against `origin/main` @ dd0f83a5 in the worktree
`breakingalpha-wt/ondemand-row-recon`.

Bottom line is at the end.

---

## RECON 1 - the miss path today

### getCompanyDetail -> resolveAlias

The detail page is a Server Component at `src/app/company/[id]/page.tsx`. It
calls the loader at line 84:

```ts
const companyDetail = await getCompanyDetail(supabase, canonicalize(companyName));
```

`getCompanyDetail` (`src/lib/data-access/getCompanyDetail.ts:93-246`) resolves
the anchor first and bails on a miss:

```ts
// getCompanyDetail.ts:97-98
const resolved = await resolveAlias(supabase, slug);
if (!resolved) return null;
```

`resolveAlias` (`src/lib/data-access/aliasResolver.ts:76-154`) tries three
queries against `companies` in order and returns `null` if all miss:

- empty input -> `null` (line 81)
- UUID match on `companies.id` (lines 85-91)
- exact match on `companies.ticker` (lines 92-99)
- `ilike` match on `companies.name` (lines 101-119)
- no anchor found -> `return null` (line 120)

Columns it selects: `id, name, ticker, sector, mention_count, key_themes,
first_seen, last_updated`. On multiple ticker/name hits it ranks by
`mention_count`, then `last_updated`/`first_seen`.

### The EmptyState vs tab-grid branch (quoted from source)

`src/app/company/[id]/page.tsx:89-95`:

```tsx
if (!companyDetail) {
  return (
    <LiveMoodShell pageTitle="Company Intel">
      <EmptyState canonical={companyName} />
    </LiveMoodShell>
  );
}
```

So: `resolveAlias` miss -> `getCompanyDetail` returns `null` -> this branch
renders `EmptyState`; the tab grid / Primer below line 95 is never mounted.

### What the Primer actually needs from the companies row

`PrimerTab` props (`src/components/company/tabs/PrimerTab.tsx:36-47`):

```ts
interface PrimerTabProps {
  companyName: string;
  ticker: string | null;
  sector: string | null;
  industry: string | null;
  description: string | null;
  financials: CompanyFinancialsResult;
  briefSlot: ReactNode;
}
```

How the page feeds it (`page.tsx:152-162`): `companyName=companyDetail.display`
(from `companies.name`), `ticker=companyDetail.ticker`, `sector` (mode of
article sectors, not the DB column directly), `industry`/`description` from a
static `COMPANY_IDENTITY` map (NOT the DB), `financials` from
`fetchCompanyFinancials` (never null; empty view when no CIK).

Sub-component null-safety (all confirmed non-crashing):

- `PrimerSnapshot` (`primer/PrimerSnapshot.tsx:34-47`): `{companyName}`,
  `{ticker || "Private"}`, `{sector || DASH}`, `{industry || DASH}`.
- `PrimerKeyStats` (`primer/PrimerKeyStats.tsx:56-114`): takes `{ quote, loading }`,
  renders an empty state when `quote` is null. `quote` is fetched LIVE by ticker
  via `/api/company-kpis` (Yahoo), not from the row.
- `PrimerBusinessOverview` (`primer/PrimerBusinessOverview.tsx:18-27`): only
  rendered when `description` is truthy.
- `PrimerFinancialSnapshot` (`primer/PrimerFinancialSnapshot.tsx:34`): `financials`
  is always a `CompanyFinancialsResult`; empty grid when `cik == null`.

The Yahoo-fed sections (Key Stats, Financial Snapshot) and the Business overview
are all driven by ticker (live fetch) or by static maps; none read a stored DB
column beyond name + ticker.

### Minimal row to mount the Primer

| Column | Needed? | Why / null behavior |
|---|---|---|
| `id` | yes (auto) | `gen_random_uuid()` default; FK anchor for mentions/aliases queries |
| `name` | yes (required) | `NOT NULL`, no default; rendered as `companyName` |
| `ticker` | strongly wanted | nullable; null renders "Private" and every live Yahoo fetch returns empty. Without it the Primer mounts but is hollow |
| `mention_count` | no (default 1) | ranking tiebreaker only |
| `first_seen`/`last_updated` | no (default now()) | ranking tiebreakers |
| `sector`, `description`, `key_themes`, `sec_cik`, `sentiment_trend`, `notes` | no | all nullable; render as dashes / empty |

Minimal insert shape: `{ name }` is the DB floor; `{ name, ticker }` is the
functional floor for a Primer that actually renders its Yahoo sections. For
`resolveAlias` to find the row on retry, `ticker` (exact) or `name` (ilike) must
match what the user navigated to.

---

## RECON 2 - Finnhub search surface

Existing route: `src/app/api/finnhub-search/route.ts`. It builds (line 28):

```
https://finnhub.io/api/v1/search?q=${encodeURIComponent(q)}&token=${FINNHUB_KEY}
```

Result shape it consumes/returns (`route.ts:3-13`):

```ts
interface FinnhubSearchItem {
  symbol: string;
  description: string;   // company name
  type: string;
  displaySymbol: string;
}
```

It filters to `type === "Common Stock" || type === "ETP"` (line 38) unless
`?all=1`, returns the first 8 as `{ symbol, description }` (line 40). A single
`/search` response carries **ticker (`symbol`) + name (`description`)**, which is
exactly the functional-minimal row. No second `profile2` call is required.

There is already a working precedent: `src/app/api/watchlist/route.ts:112-124`
calls Finnhub `/search`, matches `symbol === normalizedIdentifier`, and uses
`match.description` as the display name.

Backend twin: `backend/finnhub_helper.py:252-306` (same `/search` endpoint),
with 429 handling (`finnhub_helper.py:275-280`, `RATE_LIMIT_SLEEP_SEC = 60`, one
retry). Key is read from `FINNHUB_API_KEY` (env) in both
`finnhub_helper.py:370` and `finnhub-search/route.ts:19` (value not printed).

Other resolution surfaces (none replace Finnhub for ticker->name):
- `src/app/api/company-search/route.ts:14` Clearbit autocomplete (name+domain+logo,
  no ticker).
- `src/lib/sec-filings.ts` name->CIK via SEC `company_tickers.json` (public filers
  only).
- `backend/finnhub_helper.py:58-65` `HARD_TICKER_OVERRIDES` (e.g. `spacex -> SPCX`)
  is the pinned source of truth for ambiguous/fresh listings.

---

## RECON 3 - write-auth model (the critical part)

### How companies rows are written today

All writers are service-role, server-side:

- Pipeline: `backend/supabase_client.py:69-79` `get_service_client()` requires
  `SUPABASE_SERVICE_ROLE_KEY` and refuses an anon fallback:

  ```python
  key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
  if not key:
      raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is required for the pipeline writers. ...")
  ```

- Two insert paths in the pipeline:
  - `backend/ingest.py:1386-1405` `upsert_company`: `SELECT * ... eq("name", name)`;
    on hit increment `mention_count`, on miss `insert({name, key_themes,
    sentiment_trend, mention_count:1})`. No `ON CONFLICT`; relies on prior SELECT.
  - `backend/entity_resolver.py` `_try_insert_canonical` (insert ~388-418): tries
    the insert, catches `23505`/duplicate/unique as "race lost", then best-effort
    Finnhub ticker population + alias registration. Comment states the intent is
    `INSERT INTO companies (name) VALUES ($1) ON CONFLICT (name) DO NOTHING
    RETURNING id`, using `UNIQUE(name)` as the synchronization primitive.

- Frontend already has a server-side service-role writer precedent:
  `src/app/api/watchlist-briefs/route.ts:12-43` (creates a `createClient` with
  `SUPABASE_SERVICE_ROLE_KEY`, 500s if missing). Anon key is used for user-facing
  reads, e.g. `src/app/api/companies/route.ts:30`.

### Live RLS state (queried read-only, NOT from migrations)

The repo has NO migration that enables RLS or creates a policy on `companies`
(`backend/supabase_client.py:3-8` describes a *future* "RLS lockdown Phase 2"
that has not landed as a migration). But the LIVE database already has RLS on,
with a single wide-open policy:

```
pg_class:  companies.relrowsecurity = true,  relforcerowsecurity = false

pg_policy on public.companies:
  polname        = "Allow all"
  polcmd         = ALL ('*')
  USING (qual)   = true
  WITH CHECK     = NULL
  roles          = NULL  (= PUBLIC, includes anon)
```

A permissive `ALL` policy with `USING (true)` and a NULL `WITH CHECK` falls back
to `USING` for INSERT/UPDATE checks. Net effect: **the anon key can already
INSERT/UPDATE/DELETE arbitrary `companies` rows today.** The pipeline uses
service-role by convention, but nothing at the DB layer enforces it. This is a
pre-existing hole, independent of this feature, and it directly contradicts the
service-role-only intent in the backend client. Worth closing in the Phase 2
lockdown regardless of whether on-demand insert ships.

### Write-path options (enumerated, not recommended)

| Option | Shape | Security blast radius |
|---|---|---|
| (a) Server-side API route, service-role insert | `POST /api/company/resolve` validates input, resolves via Finnhub, inserts with `SUPABASE_SERVICE_ROLE_KEY` (pattern: `watchlist-briefs/route.ts:12-43`). Browser never sees the key. | Smallest. The only writer is one validated route; you control payload shape, can rate-limit, can require auth. Does not widen RLS. |
| (b) Loosen `companies` RLS to allow anon insert | Add/keep an anon INSERT policy so the browser writes directly. | HIGH RISK. This is effectively already the live state ("Allow all"). Any holder of the public anon key can write arbitrary rows (junk names, ticker hijacking, mass inserts). Do not build on this; it should be tightened, not leaned on. |
| (c) Server Action / edge function with service-role | Next server action that does the resolve+insert. | Similar to (a); same service-role custody. Slightly more coupling to React Server Actions; no RLS change. Fine, but offers nothing over (a) for this case. |

Option (a) and (c) keep the service-role key server-side and do not depend on
the open RLS policy. Option (b) is the high-risk path and is flagged.

### Dedup / uniqueness hazard

Live constraints on `companies` (queried):

```
companies_pkey         PRIMARY KEY (id)
companies_name_key     UNIQUE (name)
companies_name_no_junk CHECK (lower(trim(name)) NOT IN
                          ('techcrunch','bloomberg','crunchbase','youtube',
                           'federal reserve','pentagon','iran'))
indexes: unique(name), unique(id), idx_companies_sec_cik (NON-unique, partial)
```

There is **no UNIQUE on `ticker` and no UNIQUE on a normalized name**. `UNIQUE(name)`
is exact and case-sensitive, and `company.name` is stored verbatim from source.
The alias system (`backend/normalize.py:8-28` `normalize_lookup_key` ->
`aliases.lookup_key`) handles variants, but it keys the *aliases* table, not the
canonical name.

Consequence: a naive on-demand `insert({ name: finnhubDescription, ticker })`
**recreates exactly the duplicate problem the dedup just cleaned up tonight**.
Finnhub returns "CISCO SYSTEMS, INC." while the canonical row is "Cisco";
`UNIQUE(name)` does not collide, so you get a second row pointing at the same
ticker/CIK. This is the AXT/Baxter, Cisco-variant failure mode all over again.

Guard an on-demand insert MUST have, at minimum:
1. Resolve the ticker first and run `resolveAlias` on BOTH the ticker (exact) and
   the resolved name (ilike) before inserting. If either hits, reuse that row.
2. Only insert when both miss, and register the surface form in `aliases`
   (lookup_key -> new canonical_id) so future variants collapse.
3. Prefer the existing `entity_resolver` semantics (`ON CONFLICT (name) DO
   NOTHING RETURNING id` + alias registration) over a bare insert. The safe
   insert is NOT a one-liner; it is entity resolution.

---

## RECON 4 - wiring + scope

### Smallest seam (no protected files)

Two candidate seams:

1. The miss branch itself (`src/app/company/[id]/page.tsx:89`). Tempting but
   wrong shape: this is a Server Component render path; mutating the DB during a
   GET render is a side-effect anti-pattern (re-runs on every render/refresh, no
   user gesture, hard to rate-limit).
2. A new `POST /api/company/resolve` route, invoked either (a) from a button in
   `EmptyState` (client) which then calls `router.refresh()`, or (b) from the
   search box at `src/app/company/page.tsx:640-645` before navigation. This is
   the clean seam.

Entry point is safe: the company directory search box
(`src/app/company/page.tsx:640-645`, debounced at 318-321, routes to
`/company/${slugify(target.name)}` at lines 565/854/920) is NOT a protected
file. It does not overlap `WatchlistAddInput` (which is protected and is the
watchlist widget, a different surface).

### Net-new vs reusable

Reuse (all unprotected):
- `resolveAlias` (`aliasResolver.ts:76-154`) for the pre-insert existence check.
- `canonicalize` / `CANONICAL` map (`src/lib/company-intel.ts:71-150`).
- Finnhub `/search` (`/api/finnhub-search/route.ts`, or the `watchlist/route.ts:112-124`
  match pattern).
- Service-role writer pattern (`watchlist-briefs/route.ts:12-43`).
- `PrimerTab` and all `primer/*` components, unchanged (already null-safe).

Net-new:
- `src/app/api/company/resolve/route.ts` (the validated resolve+insert route).
- `src/lib/data-access/insertCompanyRow.ts` (entity-resolution-aware insert
  helper; must replicate the alias/dedup guard above, not a bare insert).
- A trigger in `EmptyState` or the search box (small, unprotected).

Needs Lucas / adjacency flags:
- None of the protected files are on the path. `/api/memo/route.ts` and
  `briefing/route.ts` are sibling routes but untouched.
- The RLS lockdown is Lucas-owned territory: the live "Allow all" policy on
  `companies` and the Phase 2 plan in `supabase_client.py:3-8` are his call. The
  feature should be built to not depend on the open policy, and the policy itself
  should be tightened separately. Surface this to him.
- Any migration (e.g. adding a normalized-name unique index to harden dedup) is a
  human action, not part of this build.

---

## Bottom line

The smallest safe build is option (a): a single server-side `POST
/api/company/resolve` route that resolves the ticker through the existing Finnhub
`/search` surface, runs `resolveAlias` on both the ticker and the resolved name
to avoid creating a duplicate, inserts a minimal `{ name, ticker }` row with the
service-role key (reusing the `watchlist-briefs` writer pattern) plus an alias
registration, and then lets the client `router.refresh()` so the existing
already-null-safe `PrimerTab` mounts. It touches zero protected files and needs
no schema change. The main risk is NOT auth plumbing, it is dedup: `companies`
is UNIQUE on exact `name` only, with no ticker or normalized-name uniqueness, so
a naive insert recreates tonight's duplicate mess on the first name-variant
miss. The insert must go through entity-resolution semantics, not a bare insert.
Secondary, and worth flagging to Lucas independently of this feature: the live
`companies` RLS policy is "Allow all" (anon can already write), which both
undercuts any client-direct option (b) and is a hole the Phase 2 lockdown should
close.
