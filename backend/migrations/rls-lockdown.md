# companies RLS lockdown — recon + apply note

Read-only recon + generated migration. **Nothing was applied.** Noah applies
`companies-rls-lockdown.sql` himself in the Supabase SQL editor.

Base: worktree off fresh `origin/main` @ `ec75aa79`.

## Recon 1 — current policy state (verbatim, prod 2026-06-21)

RLS on `public.companies`: `relrowsecurity = true`, `relforcerowsecurity = false`.

Policies on `public.companies` (the only row returned by `pg_policy`):

| policyname | cmd | permissive | roles | using_expr | with_check_expr |
|---|---|---|---|---|---|
| `Allow all` | `ALL` | `true` | `{public}` | `true` | *(null)* |

The permissive `ALL` / `USING(true)` / PUBLIC policy is confirmed present. It
covers SELECT **and** INSERT/UPDATE/DELETE for anon and every authenticated
user — the open write hole. Reads must stay open; that is the only thing keeping
the frontend (anon-key reads of `companies`) working.

## Recon 2 — who actually writes companies (the check with teeth)

Every write to `companies`, with the client it runs under:

| Site | What it does | Client |
|---|---|---|
| `backend/ingest.py:1391` | UPDATE companies | `get_service_client()` (ingest.py:46) — **service-role** |
| `backend/ingest.py:1398` | INSERT companies | same — **service-role** |
| `backend/entity_resolver.py:283` | UPDATE companies | `supabase` param from ingest.py:1462 — **service-role** |
| `backend/entity_resolver.py:388` | INSERT companies | same — **service-role** |
| `backend/entity_resolver.py:411` | UPDATE companies | same — **service-role** |
| `backend/edgar/cik_mapping.py:94` | UPDATE companies.sec_cik | `sb` from ingest_sec.py:52 (`SUPABASE_SERVICE_ROLE_KEY`) — **service-role** |
| `backend/scripts/backfill_tickers.py:245` | UPDATE companies.ticker | requires `SUPABASE_SERVICE_ROLE_KEY` (line 93, "needs RLS bypass") — **service-role** |

`get_service_client()` (`backend/supabase_client.py:69`) hard-requires
`SUPABASE_SERVICE_ROLE_KEY`. `ingest_sec.py:52` builds its client directly from
`SUPABASE_SERVICE_ROLE_KEY`. The pipeline writers (entity_resolver, ingest,
cik_mapping, backfill) are all service-role — confirmed.

**TypeScript / frontend writes to `companies`: NONE.** `grep` of `src/**` for
`.from("companies")` with `.insert/.update/.delete/.upsert` returns zero hits.
The app only reads `companies` under anon.

### ANON-WRITE LIST (gates apply-safety)

**EMPTY.** No write to `companies` runs under an anon or user-scoped client.
Service role bypasses RLS, so dropping the permissive write policy breaks
nothing.

## Pattern mirrored

`public.sec_filings` (migration
`supabase/migrations/20260531000000_wd_filings_sec_filings_read_policy.sql`):
a single `"Public read access"` policy, `FOR SELECT`, `TO public`, `USING (true)`,
plus `GRANT SELECT ... TO anon, authenticated`, and **no write policy** — writes
stay on the service-role pipeline. The migration reproduces that exact shape on
`companies`, replacing the over-broad `ALL` policy with the SELECT-only one
inside a single transaction (the read never blinks).

## Bottom line

**Safe to apply immediately.** The anon-write list is empty: every `companies`
writer is service-role and bypasses RLS, and the frontend never writes. Dropping
the `"Allow all"` policy and replacing it with the SELECT-only `"Public read
access"` policy closes anon INSERT/UPDATE/DELETE while leaving public reads
fully intact. No write path needs to be migrated first. After applying, run
`companies-rls-lockdown.verify.sql` — expect `verdict = 'LOCKED OK'` (SELECT
public, zero permissive write policies).
