# Company Intel Fix Plan

**Date:** 2026-04-29
**Branch:** `noah/company-intel-investigation`
**Scope:** Actionable fix plan for the four Company Intel symptoms reported by Noah. Read-only investigation — no DB queries run, no destructive ops. Pairs with the read-only diagnostic in `COMPANY_INTEL_DIAGNOSIS.md` (root, untracked) and the watchlist diagnostic in `WATCHLIST_INGESTION_DIAGNOSIS.md`.

This document is the **primary deliverable** of this branch. It does not implement any of the fixes below. The goal is to give Wednesday-morning Noah a concrete roadmap and the verification commands to confirm each cause before writing any code.

---

## Symptom map

| # | Symptom | Severity | Lives in |
|---|---|---|---|
| 1 | Duplicate company rows ("Robinhood" / "Robinhood Markets" / "HOOD") | High | Backend writer + frontend dedup |
| 2 | Search returns nothing for many real companies | Critical | Frontend filter logic |
| 3 | Robinhood missing from UI even though `companies` row exists | Critical | Reading wrong source-of-truth |
| 4 | ExaAI integration gap suspicion | Confirmed | No Exa anywhere on `/company` |

All four symptoms stem from a single architectural gap: **`/company` does not read the `companies` table, has no API layer of its own, and runs all matching as in-memory aggregation over the latest 1500 rows of `articles`.** Symptoms 1, 3, and 4 are cleanly separable; symptom 2 is structurally entangled with symptom 3 (you can't search what you don't load).

---

## Symptom 1 — Duplicate company rows

### Root cause
The duplicate problem has two layers that compound:

**Writer layer (backend) — produces the duplicate rows in the database:**
- `backend/ingest.py:485-504` (`upsert_company`) does `supabase.table("companies").select("*").eq("name", name).execute()` — exact case-sensitive name match. Whatever string Gemini emits becomes the lookup key.
- No canonicalization step between Gemini's name extraction (in `analysis.get("companies", [])` consumed at `backend/ingest.py:528-536`) and the upsert call.
- Result: "Robinhood Markets" today, "Robinhood" tomorrow, "Robinhood, Inc." the day after — three rows, three `company_id`s, three `mention_count` counters fragmented across them.

**Reader layer (frontend) — papers over duplicates with a small hardcoded map:**
- `src/app/company/page.tsx:225-252` aggregates by `display.toLowerCase()`, where `display = canonicalize(raw)`.
- `src/lib/company-intel.ts:65-143` (`CANONICAL`) is a ~50-entry lowercase-keyed lookup. It covers Mag-7, JPMorgan, Goldman, Lockheed, NVIDIA variants — and explicitly does NOT cover Robinhood, HOOD, COIN, SOFI, SHOP, BA, CRWD, UBER, or 18 months of fintech IPOs.
- `src/lib/company-intel.ts:151-152` (`LEGAL_SUFFIX_RE`) strips `Inc/Corp/LLC/Ltd/PLC/L.P./LLP/S.A./N.V./AG/GmbH` but does **not** strip "Markets", "Holdings", "Group". So "Robinhood Markets" stays "Robinhood Markets" after canonicalization, and "Robinhood" stays "Robinhood" — different keys, different cards.
- `src/lib/company-intel.ts:315-329` (`canonicalize`) is the only canonicalization site. It runs at render time; the writer never calls it.

### Proposed fix scope
Two-phase. Both phases are needed; either alone is incomplete.

**Phase 1A — Stop creating new duplicates (backend, mandatory):**
- Add a canonicalization helper to `backend/ingest.py` that applies the same logic as `src/lib/company-intel.ts::canonicalize`. Either inline it as a Python dict + regex, or read a JSON canonical-name file shared between Python and TypeScript.
- Call it from `upsert_company(name, ...)` before the `select("*").eq("name", canonical_name)` lookup.
- Optional but recommended: also write the canonicalized name to `articles.companies` (the text array) at `backend/ingest.py:545-562`, so the array reflects the canonical form.

**Phase 1B — Repair existing duplicates (one-time backfill):**
- A SQL backfill that groups `companies` rows by canonical name, sums `mention_count`, merges `key_themes`, and deletes losers. Out of scope for this PR — write the migration but do not run it. Live data merge needs human review.

**Phase 1C — Broaden frontend dedup (frontend, low-risk):**
- Add ~20 missing entries to `CANONICAL` (Robinhood, Robinhood Markets, HOOD, COIN, SOFI, SHOP, BA, CRWD, UBER, ZS, NET, DDOG, SNOW, MDB, OKTA, HOOD's siblings).
- Extend `LEGAL_SUFFIX_RE` to optionally strip `Markets`, `Holdings`, `Group`, `International` when followed by `Inc/Corp` or end-of-string (mirror `src/lib/watchlist-utils.ts:36-44`).
- This is the smallest visible-result patch. It does NOT fix the database duplicates — those persist until Phase 1A.

### Risk to launch
- Phase 1A: **medium**. Touches `backend/ingest.py`, which is cron-adjacent. Requires verification that canonicalization doesn't change the meaning of "real" different companies (e.g. "Apple" vs "Apple Hospitality REIT"). The hardcoded list approach is safer than fuzzy matching.
- Phase 1B: **high if run, low if deferred**. SQL data-merge migrations are the highest-risk class. Defer until post-launch.
- Phase 1C: **low**. Pure data file edit, no schema change, no migration, contained blast radius.

### Recommended fix order (within symptom 1)
1. Phase 1C first (small, safe, immediately visible to users).
2. Phase 1A second (prevents regression).
3. Phase 1B last (and only after a manual review of every duplicate cluster — Noah should personally approve the merge plan).

### Testing approach
- After 1C: open `/company`, scroll the company list, verify Robinhood/Robinhood Markets/HOOD now collapse to one card.
- After 1A: run a single ingestion locally (against a dev Supabase, NOT prod) and confirm no new duplicate rows appear in `companies` for canonicalized names.
- Observable outcome: `select name, count(*) from companies group by name having count(*) > 1` should not grow after 1A is deployed.

---

## Symptom 2 — Search returns nothing for many real companies

### Root cause
Search is a **pure client-side `Array.prototype.filter` over the in-memory company list**. Three exact lines determine the entire search experience:

- `src/app/company/page.tsx:280-284`:
  ```ts
  if (search.trim()) {
    const q = search.toLowerCase();
    result = result.filter((c) => c.name.toLowerCase().includes(q));
  }
  ```
- `src/app/company/page.tsx:414-422` — the input element. No submit handler, no debounced fetch, no API call.

The `companies` array being filtered is built from `articles.companies` over the latest 1500 articles (`src/app/company/page.tsx:201-270`). If a company hasn't surfaced in that rolling window, it's unreachable by any search query — the input filters a list that doesn't contain it.

There IS an existing Clearbit-backed search at `src/app/api/company-search/route.ts:9-30`, but `/company` does not consume it. (It's used only by the watchlist add-input flow.)

### Proposed fix scope
Replace the in-memory filter with a debounced server-side search that hits the curated `companies` table (and optionally falls through to Clearbit).

**Files to change:**
- `src/app/company/page.tsx:280-300` — replace the `useMemo` filter with a `useEffect` + debounced fetch when `search.trim().length >= 2`.
- New file: `src/app/api/companies/route.ts` — `GET /api/companies?q=foo&limit=20` returning canonicalized rows from `companies` (ilike on name) joined with `company_mentions` for last-30d activity counts.
- Optional: extend the route to also `ilike` on `companies.ticker` once that column is reliably populated (today it's mostly NULL per the watchlist diagnostic).
- Optional fall-through: when `companies` returns 0 results, hit `/api/company-search` (Clearbit) and surface those results with a "not in our database" badge.

**Files NOT to change:**
- `backend/ingest.py` — out of scope for the search fix; tracked separately under symptom 1.
- `src/components/onboarding/OnboardingWizard.tsx` — Lucas modified this in the last 6 hours; flagging not modifying.
- `src/components/thesis/thesis-detail-panel.tsx` — Lucas modified; not modifying.

### Risk to launch
**Medium.** The server-side ilike search is mechanically simple, but it changes the user contract: today the search box "filters what's on screen", tomorrow it "searches the database". UI copy and empty-state messaging need to match the new behaviour. There's a usability risk if the server returns companies the user clicks on and the detail panel shows zero articles (because they aged out of the 1500 window — symptom 3 territory).

### Recommended fix order
- Independent of symptom 1 (Phase 1C reduces noise but isn't a blocker).
- Should ship **after or alongside symptom 3**. Symptom 3 is "the right company is missing"; symptom 2 is "I can't find the right company". Fixing search alone, without fixing the underlying data source, gives users a way to discover companies that then render empty detail panels — worse UX than today.

### Testing approach
- After: open `/company`, type "Robinhood" — verify a result row appears within ~250ms of typing.
- Type "HOOD" — verify the same result appears (only if ticker support is included; defer if not).
- Type "asdfqwer" — verify graceful empty state, no console errors.
- `npx tsc --noEmit` — verify the new route and edited page compile cleanly.

### Needs more investigation
- Does `companies.ticker` get populated reliably enough to ilike-search on? Per the watchlist diagnostic (cause #2), the ticker column is mostly NULL. If true, ticker-based search needs a Finnhub fallback or a one-time backfill.

---

## Symptom 3 — Robinhood missing from the UI even though `companies` row exists

### Root cause
**`/company` does not read the `companies` table at all.** The list shown to users is a re-derived in-memory aggregation over the latest 1500 rows of `articles`. Verified via grep across `src/app/company/`, `src/components/company/`, and `src/lib/company-intel.ts` — zero references to `from("companies")`.

- `src/app/company/page.tsx:201-270` (`load()`) — `articles.select("companies, sector, primary_company").order("ingested_at", { ascending: false }).limit(1500)`. That's the entire list source.
- `src/app/company/[id]/page.tsx:49-55` — same `articles.select(...).limit(1500)` pattern for the detail route.

Per the diagnostic, Robinhood's actual database state is `mention_count=2, last_updated=2026-04-09`. On 2026-04-29 (today), those two mentions are 20 days old. They have almost certainly aged out of the 1500-article rolling window — so even though the row exists, no `articles.companies` array in the current window contains "Robinhood", and the list aggregation produces no Robinhood card.

This is the same root cause that drives symptom 4 (no Exa-sourced articles flowing into `/company`'s data source).

### Proposed fix scope
Pivot the list source from "aggregated articles" to "the `companies` table".

**Files to change:**
- New file: `src/app/api/companies/route.ts` (same one from symptom 2) — paginated reader of the `companies` table joined with `company_mentions` for last-30d mention counts.
- `src/app/company/page.tsx:201-270` — replace the `useEffect` `load()` body with a fetch to `/api/companies`. Keep `parseCompanies`/`canonicalize` as enrichment over the API response, not the primary source.
- `src/app/company/[id]/page.tsx:49-55` — replace the `articles.select(...).limit(1500)` with a fetch to `/api/companies/[id]/articles` that does (a) cache-first read of `watchlist_articles WHERE identifier = canonical_name`, (b) fall-through to `articles.companies @> ARRAY[name]` (DB-side, not LIMIT-1500-then-filter). See symptom 4 for the cache-first pattern.

**Files NOT to change:**
- Anything Lucas touched (see `/tmp/lucas-recent.txt`).
- Memo route `src/app/api/memo/route.ts` — its inputs change but its logic doesn't.

### Risk to launch
**Medium-high.** This is the single largest semantic change in the plan. Today users see "companies recently in the news"; tomorrow they see "every company we've ever indexed". Empty-state messaging, ordering (by `mention_count` vs `last_updated`), and pagination all need new copy. There's also a meaningful risk that the `companies` table has long-tail garbage from 2026-Q1 ingest experiments — a one-time data-quality audit is needed before flipping the source.

### Recommended fix order
- Phase 3A: ship `/api/companies` (the reader endpoint). Risk: low — it's a new file.
- Phase 3B: switch the list page to consume it. Risk: medium — visible UX change.
- Phase 3C: switch the detail page to a per-company article reader. Risk: medium — ties into symptom 4.

### Testing approach
- After 3A: `curl 'http://localhost:3000/api/companies?q=robinhood'` returns at least one row.
- After 3B: open `/company`, verify Robinhood appears in the list (no search needed).
- After 3C: click into Robinhood, verify articles render — even if from cache or Exa rather than the global `articles` pool.
- `npx tsc --noEmit` — verify compilation.

### Needs more investigation
- Does the `companies` table have data-quality issues that make a wholesale switch unsafe? Before flipping the source, run (separately, in Supabase Studio) `select count(*) from companies where name is null or length(name) < 2` and `select count(*) from companies where name ~ '^[a-z]+$' and length(name) < 4` to check for garbage. Document the baseline.

---

## Symptom 4 — ExaAI integration gap

### Root cause
**Confirmed: zero Exa integration anywhere in Company Intel.** Verified via grep across `src/`, `backend/`, and the lib files. Exa is consumed only in `backend/watchlist_sync.py:331-379` (`fetch_exa_articles`), which writes to a sibling table (`watchlist_articles`) that `/company` never queries.

- `backend/watchlist_sync.py:475-505` — `upsert_articles_batch` writes Exa results to `watchlist_articles`, keyed on `(identifier, article_id)`. Never to `articles`. Never to `companies`. Never to `company_mentions`.
- `src/app/company/`, `src/components/company/`, `src/lib/company-intel.ts` — zero references to `Exa`, `EXA_API_KEY`, `api.exa.ai`, `watchlist_articles`.

The `/watchlist` UI string at `src/app/watchlist/page.tsx:1121` advertises "We search Exa, Finnhub, and GDELT twice daily" — that's a **watchlist-only** promise. `/company` makes no such promise and has no such mechanism.

Architectural delta vs watchlist (from the diagnostic, repeated for clarity):

| Capability | Watchlist | Company Intel |
|---|---|---|
| Per-identifier pre-fetch from Exa/Finnhub/GDELT | yes (`watchlist_sync.py`) | no |
| Dedicated cache table | yes (`watchlist_articles`) | no |
| Ticker→name resolution | yes (`LEGACY_TICKER_NAMES` + `getCompanySearchTerms`) | no |
| Cache-first read with API fallback | yes (`watchlist/page.tsx:283-352`) | no |
| Story clustering | yes (`watchlist_sync.py:106-140`) | no |

### Proposed fix scope
Either (a) add a per-company Exa/Finnhub fetcher analogous to `fetch_exa_articles` triggered lazily when a user opens `/company/[id]`, OR (b) reuse `watchlist_articles` directly by treating `companies.name` as a synthetic "identifier" and reading the existing table.

**Recommended approach: option (b).** Reuses existing infrastructure, no new cron, no new table. The trick is that `watchlist_articles` is keyed by user-watchlist `identifier`, which is whatever string the user typed — for many users this overlaps with `companies.name` already. A read-only join works:

```sql
select wa.* from watchlist_articles wa
where lower(wa.identifier) = lower($1)  -- canonical company name
order by published_at desc
limit 50;
```

**Files to change:**
- New file: `src/app/api/companies/[id]/articles/route.ts` — cache-first read of `watchlist_articles` by canonical name, falling through to `articles.companies @> ARRAY[name]` when cache empty.
- `src/app/company/[id]/page.tsx:49-55` — switch to consume the new endpoint.
- Optional Phase 4B: extend `backend/watchlist_sync.py` to also fetch for the top-N companies by `mention_count` from the `companies` table, even when no user has them watchlisted. This is the cron-adjacent path; defer until post-launch.

**Files NOT to change:**
- `backend/run.py` — cron-adjacent, hard-blocked by this branch's constraints.
- `backend/ingest.py` — same.
- `backend/watchlist_sync.py` (for read path) — out of scope tonight; Phase 4B work.

### Risk to launch
- Phase 4A (read-only `watchlist_articles` join): **low**. Read-only, additive, doesn't disturb watchlist.
- Phase 4B (proactive fetch for top companies): **medium**. Cron-adjacent, requires verifying Exa/Finnhub rate-limit headroom.

### Recommended fix order
- Phase 4A independently, after symptom 3 phases (the new `/api/companies/[id]/articles` route is the natural carrier).
- Phase 4B last, only if 4A doesn't close the gap. Most users with Robinhood as a thesis subject likely also have it in their watchlist, so 4A may give 90% of the win.

### Testing approach
- After 4A: open `/company/Robinhood`, verify Exa-sourced articles appear in the detail panel even though the global `articles` pool has none.
- Observable outcome: an article whose `source_type = 'exa'` (in `watchlist_articles`) renders inside `/company/Robinhood`.
- `npx tsc --noEmit` for the route.

### Needs more investigation
- Are there RLS policies on `watchlist_articles` that block cross-user reads? The cache-first read assumes any user can read articles fetched for any other user's watchlist. If RLS prevents that, the design needs a shared `company_articles` mirror or service-role queries from the API route.
- Does `watchlist_articles.identifier` reliably contain canonical company names, or user-supplied strings ("hood", "Robinhood Markets, Inc.", "robinhood markets")? If the latter, a join on canonicalized identifier is needed.

---

## Cross-cutting concerns (apply to all four symptoms)

### A. The `/company` route has no API layer
Today every read is a direct browser→Supabase call. Watchlist has 9 dedicated `/api/watchlist-*` reader routes. Closing this gap is a precondition for fixing symptoms 2, 3, and 4 without leaking complex query logic into client components.

**Recommended structural change:**
- `src/app/api/companies/route.ts` — list + search
- `src/app/api/companies/[id]/route.ts` — single company with mention counts
- `src/app/api/companies/[id]/articles/route.ts` — articles for a company (cache-first, see symptom 4)

These three routes form the minimum API surface. After they exist, the page components shrink and the data contract becomes testable.

### B. Lucas's recent files (do not modify)
Per `/tmp/lucas-recent.txt` (re-read at start of run; contents below):

```
src/components/onboarding/OnboardingWizard.tsx
src/components/thesis/thesis-detail-panel.tsx
```

Neither of these is on any fix path proposed above. **No overlap.** Confirmed.

### C. Constraints worth re-stating
- Phase 1B (data merge migration) requires Supabase SQL execution. **Out of scope for this branch.**
- Phase 1A (canonicalization in `upsert_company`) modifies `backend/ingest.py`, which is cron-adjacent. **Out of scope for this branch.** Should be a separate PR with extra review.
- Phase 4B (proactive Exa fetch for top companies) modifies `backend/watchlist_sync.py`. **Out of scope for this branch.**

The actually-shippable-tonight subset of this plan is: Phase 1C (frontend dedup map expansion) + the three `/api/companies*` routes + their consumption in the page components. Even that is more than fits in <30 lines, so the optional code fix slot in this PR ships nothing — see "Optional fix shipped" in the PR body.

---

## Recommended global fix order

If Noah can ship one PR per day Wednesday-Friday:

1. **Wednesday AM:** Phase 1C — broaden `CANONICAL` map and `LEGAL_SUFFIX_RE`. Single-file frontend change. Closes the most visible duplicates immediately. ~30 min of work, ~30 min of QA.
2. **Wednesday PM:** Phase 3A — ship `/api/companies` reader endpoint (no UI change yet). Lays the API foundation. Test in isolation via curl.
3. **Thursday AM:** Phase 3B + symptom 2 — switch the list page to consume `/api/companies` and replace client-side filter with debounced fetch. Visible UX change; needs careful empty-state copy review.
4. **Thursday PM:** Phase 3C + Phase 4A — `/api/companies/[id]/articles` with `watchlist_articles` cache-first fallback. Closes Robinhood-detail gap.
5. **Friday:** Phase 1A — backend canonicalization in `upsert_company`. Separate PR, tagged for backend review. Run a single ingestion against a dev project before merging.
6. **Post-launch:** Phase 1B (data merge) and Phase 4B (proactive Exa fetch).

If only one thing can ship: Phase 1C. It's a single-file edit, blast radius limited to display strings, and visibly fixes the most-reported symptom (duplicates).

---

## Verification commands for Wednesday-morning Noah

Run these to confirm the diagnoses in this document before writing code:

```bash
# Confirm /company has no API layer
ls src/app/api/companies 2>&1 | head -5
# Expected: "No such file or directory"

# Confirm Exa is not consumed in the /company route
grep -r "exa\|EXA" src/app/company/ src/lib/company-intel.ts | head
# Expected: no matches

# Confirm the page reads articles, not companies
grep -n "from(\"companies\"\|from('companies'" src/app/company/page.tsx src/app/company/\[id\]/page.tsx
# Expected: no matches

# Confirm CANONICAL doesn't include Robinhood
grep -i "robinhood\|hood" src/lib/company-intel.ts
# Expected: empty (proves the gap)

# Confirm Robinhood's actual database state (one-shot Supabase Studio query, not committed):
# select id, name, ticker, mention_count, last_updated from companies where name ilike '%robinhood%' or ticker = 'HOOD';
# select id, title, ingested_at from articles where 'Robinhood' = ANY(companies) order by ingested_at desc limit 5;
```

The last two queries confirm whether the diagnostic's assumption — that Robinhood mentions have aged out of the 1500-window — is currently true or false.

---

## Honest known unknowns

1. **Exact size of the duplicate problem.** The diagnostic identifies the mechanism but doesn't enumerate every duplicate cluster. Before Phase 1B, run `select name, count(*) from companies group by name having count(*) > 1 order by count(*) desc` to get the actual list.
2. **`companies.ticker` populate rate.** The watchlist diagnostic says it's mostly NULL. Confirm before designing ticker-based search.
3. **`watchlist_articles.identifier` canonicalization.** Are entries already canonicalized, or do they contain user-supplied raw strings? Affects the symptom 4 join design.
4. **RLS posture on `companies`, `company_mentions`, `watchlist_articles`.** The chat-context RLS audit referenced in the diagnostic is not on disk. Without it, every API route design above assumes anon-key reads work.
5. **`/company` traffic vs cron load.** If `/company` becomes the primary surface for company discovery, lazy Exa fetches per page-view could blow Exa rate limits. Phase 4B's design needs cost-modeling against current Exa quota.
6. **Whether `/company` is in scope for the imminent launch at all.** The architectural delta from watchlist is large enough that the right product call may be to soft-deprecate the current `/company` and direct users to watchlist for company tracking until convergence is complete. That's a Noah call.

---

## Companion documents

- `COMPANY_INTEL_DIAGNOSIS.md` (root, untracked, written 2026-04-28) — the read-only diagnostic this plan turns actionable.
- `WATCHLIST_INGESTION_DIAGNOSIS.md` (root, untracked) — shared root causes #2, #3, #5 in that doc are also responsible for symptoms 1 and 3 here.
