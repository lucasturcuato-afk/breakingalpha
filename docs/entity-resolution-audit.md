# Entity Resolution Audit (Read-Only)

**Branch:** `w2/entity-resolution-audit`
**Date:** 2026-04-30
**Scope:** Wave 2 W2-A planning input. Maps every place an entity (company) name is extracted, normalized, persisted, joined, or rendered. Identifies the failure modes Noah and Lucas asked W2-A to fix (Anthropic vs Anthropic-with-typo, anthropic.io vs anthropic.com, Stripe unfindable on Ticker tab, etc.). Read-only. No code, schema, or data changes were made by this audit.

**Provenance disclosure.** No `.env.local` or backend `.env` is present in this worktree, and the audit does not have prod Supabase credentials. **All "DB-state" claims below are derived from static code analysis, the SQL/migration files in this repo, and Noah's prior diagnosis docs (`COMPANY_INTEL_DEEP_DIAGNOSIS.md`, `COMPANY_INTEL_FIX_PLAN.md`, `COMPANY_INTEL_INVESTIGATION_SUMMARY.md` in the main worktree). Sample rows and duplicate counts in §3 are illustrative classes the code admits, not live row counts.** Sections that would need a live `SELECT` to verify are flagged inline as `[unverified - code analysis]`.

**Audit constraint compliance.** `backend/ingest.py` and `backend/synthesize.py` were read for tracing only. No edit operations were performed against any file outside `docs/entity-resolution-audit.md`.

---

## 1. Schema inventory - every place a company name lives

The system has **no canonical entity ID**. Names are denormalized free text in nearly every relevant table. The only "entity" surface that approximates a primary key is `companies.id` (UUID), but it is keyed by `companies.name` (a `text` column), and the same logical entity can have multiple rows under different name variants.

| Table | Key entity column(s) | Type | How populated | How joined | Canonical FK? |
|---|---|---|---|---|---|
| `public.companies` | `id (uuid)`, `name (text)`, `ticker (text, nullable)`, `sector (text, nullable)`, `mention_count (int)`, `key_themes (text[])`, `last_updated (timestamptz)` | Free-text name; `id` is a row UUID, not an entity QID | `backend/ingest.py:631-650` `upsert_company()` does `.select("*").eq("name", name)` - case-sensitive name match decides update vs insert. No normalization on read or write. | `company_mentions.company_id` FK joins back. Frontend reads via `/api/companies` (`src/app/api/companies/route.ts`). Display dedup happens **client-side only** via `dedupeAndMapApiCompanies()` in `src/app/company/page.tsx:55-74` calling `canonicalize()`. | **No.** `id` is per-row, not per-entity. Two rows for "Anthropic" and "Anthropic PBC" are two distinct `id`s and two distinct `mention_count` totals on the server. |
| `public.company_mentions` | `company_id (uuid, FK companies)`, `article_id (uuid, FK articles)`, `context (text)`, `sentiment (text)` | Insert in `backend/ingest.py:710-717` per article-per-clean-company. | Joins back to `companies.id`. | **Inherits the duplication.** A "Meta Platforms Inc." article inserts a mention against the "Meta Platforms Inc." row, not the canonical "Meta" row. |
| `public.articles.companies` | `companies (jsonb / text[])` - array of strings (raw clean names) | `backend/ingest.py:691-708` `store_article()` writes the `clean_companies` list (post-blocklist + post-Wikidata) directly into the row. Array elements are bare strings, not IDs. | Read everywhere as text array. Frontend parses via `parseCompanies()` (`src/lib/company-intel.ts:425-431`) and matches via `canonicalize()` lowercase string compare (`filterAndClassifyArticles`, `src/lib/company-intel.ts:521-585`). | **No FK.** No referential integrity to `companies.id`. The same article will list "Anthropic PBC" or "Anthropic" depending on what Gemini emitted that day. |
| `public.articles.primary_company` | `text`, nullable | Gemini extraction in the FILTER_PROMPT (`backend/ingest.py:150`), persisted verbatim from `analysis.get("primary_company")` (`ingest.py:706`). | Used by `src/lib/company-intel.ts:findCompanyDevelopments` and by frontend ticker/company filters; matched via `canonicalize()` substring compare. | **No FK.** Free text. May or may not appear in `companies.name` rows. |
| `public.watchlist` | `id (uuid)`, `user_id (uuid)`, `identifier (text)`, `type (enum 'ticker'\|'company'\|'sector')`, `display_name (text, nullable)`, `created_at`, `updated_at`, `sort_order (int, nullable)`, `pinned_position (int, nullable)` | Insert via `src/app/api/watchlist/route.ts:55-143`. Tickers uppercased; company `identifier` = whatever string the user typed or selected from Clearbit autocomplete. | **No join to `companies`.** Watchlist `identifier` and articles are matched at query time via `buildArticleOrFilter()` (`src/lib/watchlist-utils.ts:99-127`) - a `.ilike` against `articles.primary_company` and `articles.title`. | **No FK.** Same brand can be tracked twice ("Stripe" vs "stripe") - the route only blocks exact-equal tickers and case-insensitive companies/sectors per user. |
| `public.watchlist_articles` | `identifier (text)`, `article_id (text)`, `title`, `url`, `source`, `source_type` ('finnhub'\|'exa'\|'gdelt'), `summary`, `published_at`, `relevance_score`, `fetched_at`, UNIQUE(identifier, article_id) | Pre-fetched by `backend/watchlist_sync.py` per identifier (Finnhub for tickers, Exa+GDELT for companies). Identifier is the bare watchlist `identifier` (uppercase ticker, or company display string). | Joined by **case-sensitive `identifier` equality** in `src/app/api/watchlist-articles/route.ts:22` and `src/app/api/companies/[id]/articles/route.ts:30-54`. | **No FK to `companies`.** Mismatched casing or punctuation produces empty result sets. |
| `public.wikidata_entity_cache` | `name (text)`, `wikidata_description (text)`, `is_company (bool, nullable)` | `backend/wikidata.py:108-160` upserts after each extraction call. | Read-only cache. No FK back to `companies`. | **No.** Cache key is the raw extracted name string - same brand under two name variants creates two cache entries. **Schema not in repo SQL** - table was created manually in Supabase. |
| `public.deal_flow` | `company (text)`, `acquirer (text, nullable)`, `deal_type`, `value`, `status`, `notes`, `source`, `ingested_at`, `sentiment` | Written by `backend/deal_extractor.py:188-225`. Free-text `company` and `acquirer` come from Gemini deal extraction. | Sidebar dedups client-side via `normalizeCompany()` (`src/components/deal-flow/DealFlowSidebar.tsx:80-90`). | **No FK.** Company and acquirer are independent free-text columns. |
| `public.theses` | `id (uuid)`, `title`, `sector`, `ticker (text)`, `top_companies (jsonb)`, `representative_article_ids`, plus 20+ others | Generated by `backend/thesis_generator.py:130-220` from clusters; `top_companies` is a JSON-encoded array of name strings (`thesis_generator.py:1219`, `trend_mapper.py:1015`). | No join - `top_companies` is a flat string array used for display only. | **No FK.** Pure free text. |
| `public.trend_clusters` | `top_companies (jsonb / text[])` | `backend/trend_mapper.py:1145-1219` aggregates from `articles.companies`. | None. | **No FK.** Inherits whatever variants are in `articles.companies`. |
| `public.user_saved_deals` | `deal_id (text)` - composite key string `company\|acquirer\|deal_type` | `src/app/api/saved-deals/...` | Composite key embeds raw `company` and `acquirer` strings - duplication-prone at the deal level. | **No FK.** |
| `auth.users` (Supabase) | `id (uuid)`, `email` | Supabase Auth | Referenced by `watchlist.user_id`, `user_profiles.id`, etc. | Out of scope for entity layer. |

**Headline finding:** every entity-aware table stores a free-text name. There is no `entities` (or `companies_aliases`) table that maps variants to one canonical row. The only "alias map" is the **client-side TypeScript** `CANONICAL` dictionary in `src/lib/company-intel.ts:65-230`, which the backend does not consult.

**Tables that DO have a stable identifier** (and therefore are *not* the W2-A problem): `articles.id`, `briefings.id`, `theses.id`, `watchlist.id`, `auth.users.id`, `user_saved_deals.id`. The W2-A problem is exclusively about **company-name strings** scattered across the columns above.

---

## 2. Extraction & normalization pipeline (file:line trace)

The pipeline runs once per article during ingestion. Frontend canonicalization is a separate, divergent layer.

### 2.1 Backend: ingest.py (writes to `articles.companies`, `companies`, `company_mentions`)

1. **Gemini extraction.** `FILTER_PROMPT` (`backend/ingest.py:109-152`) and `BATCH_FILTER_PROMPT` (`ingest.py:155-204`). Prompt asks for typed entities: `[{"name": "Acme Corp", "entity_type": "company"}, ...]`. Has explicit EXCLUDE block for currencies, countries, gov bodies, indexes, abstract phrases, products. Includes hand-curated examples ("OpenAI not ChatGPT", "Anthropic not Claude", "Microsoft not Windows"). **No instruction to canonicalize**: prompt says "verbatim from the title or summary".
2. **Parse to flat list.** `extract_company_names()` (`ingest.py:307-332`). Filters dict items where `entity_type != "company"`. Strips whitespace. **No case-folding, no suffix stripping, no Unicode normalization.**
3. **Blocklist filter.** `is_blocked_entity()` (`ingest.py:254-270`). Checks lowercased name against:
   - `_CURRENCY_BLOCKLIST` (set of 21 strings)
   - `_COUNTRY_BLOCKLIST` (set of 30 strings)
   - `_GOV_ACRONYM_RE` regex (cia, imf, nato, doj, fbi, fda, ftc, cfpb, cftc, finra, fdic, occ, nasa, faa)
   - `_GOV_SUBSTRINGS` (list of substrings: "department of", "ministry of", "federal reserve", "white house", "pentagon", "european commission", "bank of england", etc.)
   - `_LAW_SUBSTRINGS` (" llp", " & associates", "law firm", "p.c.", "pllc", etc.)
   Performs `.lower().strip()` only. **Does not strip non-breaking space (U+00A0), zero-width space (U+200B), or other Unicode whitespace.**
4. **Wikidata validation.** `is_valid_company(name, supabase)` (`backend/wikidata.py:108-160`). Cache-first against `wikidata_entity_cache`. Cache miss → Wikidata search API, classify by description keywords: `_DROP_DESCRIPTION_KEYWORDS` (24 entries: "country", "government agency", "central bank", "natural person", "stock market index", "news agency", etc.) vs `_KEEP_DESCRIPTION_KEYWORDS` (15 entries: "company", "corporation", "bank", "manufacturer", "private equity", etc.). **`_classify` returns `None` on ambiguous (no keyword matches in either list) and the function defaults to KEEP** (`wikidata.py:95, 105, 131`). API errors also default to KEEP (`wikidata.py:77, 134`).
5. **Insertion.** `store_article()` (`ingest.py:661-721`). Writes `clean_companies` (the post-filter list of bare strings) directly into `articles.companies`. Then for each name, calls `upsert_company()` which does `select(*).eq("name", name)` - **case-sensitive exact-string match** decides update vs insert. Then inserts a `company_mentions` row tying that company's UUID to the article.

### 2.2 What normalization happens, and what does NOT

| Transformation | Where applied | Where NOT applied |
|---|---|---|
| `.strip()` (ASCII whitespace) | `ingest.py:323, 328, 257, 410` (frontend `canonicalize` line 410) | Nowhere unicode-aware. NBSP / ZWSP / fullwidth space pass through silently. |
| `.lower()` | Blocklist (`ingest.py:257`), Wikidata cache lookup (effectively, via key comparison done downstream), frontend `canonicalize` (`company-intel.ts:411`) | Insertion into `articles.companies`, `companies.name`, `wikidata_entity_cache.name`. The persisted name preserves whatever case Gemini emitted. |
| Trailing `.` and `,` strip | Frontend only: `canonicalize` (`company-intel.ts:410` `.replace(/[.,]$/g, "")`) | Backend never strips trailing punctuation before insert. "Anthropic." and "Anthropic" become two rows. |
| Legal-suffix strip (Inc / Corp / Ltd / LLC / PLC / LP / LLP / SA / NV / AG / GmbH; optionally preceded by Markets / Holdings / Group / International) | Frontend only: `LEGAL_SUFFIX_RE` (`company-intel.ts:246`), used inside `canonicalize` | Backend never strips suffixes. "Apple Inc" and "Apple" are two rows in `companies`. |
| Variant → canonical brand map | Frontend only: `CANONICAL` dict (`company-intel.ts:65-230`, ~150 entries: "google" → "Alphabet", "facebook" → "Meta", "amazon.com" → "Amazon", "anthropic pbc" → "Anthropic", etc.) | Backend never consults this map. The backend writes raw extracted strings; the frontend collapses them at render time only. |
| Domain stripping (`.com`, `.io`, `.ai` suffix) | **Nowhere in entity layer.** `watchlist-utils.ts:65` strips `.com` only as part of ticker name normalization for article search, not for entity dedup. | Anywhere. "anthropic.com" and "anthropic.io" survive as two rows in `companies` and as two `articles.companies` array entries. |
| Unicode NFC / NFKC normalization | **Nowhere.** | Anywhere. Composed vs decomposed accented characters survive as distinct strings. |
| Title dedup (whole-article) | `_normalize_title()` (`ingest.py:653-658`) - lowercase, strip punctuation, collapse whitespace. Used only for blocking duplicate articles in last 24h, not for company names. | Company name dedup. |

### 2.3 Specific cases the user asked about

- **"Anthropic" with non-breaking space (`Anthropic` followed by U+00A0).** Backend `is_blocked_entity` does `.lower().strip()`. Python's `str.strip()` with no args strips ASCII whitespace plus a small Unicode set, but `.lower()` does not normalize Unicode. The string still contains the NBSP internally, and the `companies.name` insert preserves it. `upsert_company`'s `.eq("name", name)` match against existing "Anthropic" (no NBSP) row will miss, producing a duplicate row. **Verdict: dedup fails.** [unverified - code analysis]
- **"anthropic.com" vs "anthropic.io".** Neither backend nor `CANONICAL` map contains domain-stripping logic. Both strings survive as separate `companies.name` rows and as separate `articles.companies` array entries. The frontend `canonicalize` returns each one as-is. **Verdict: dedup fails.**
- **"Meta" vs "Meta Platforms".** `CANONICAL` map has "meta", "meta platforms", "meta platforms inc", "meta platforms, inc.", "facebook" all → "Meta" (`company-intel.ts:78-82`). Frontend display dedup works. **Backend, however, persists each variant as a separate `companies` row.** `companies.mention_count` is split across all variants. **Verdict: display merges, server data does not.**
- **"Google" vs "Alphabet".** `CANONICAL` has both → "Alphabet" (`company-intel.ts:71, 74`). Same pattern: frontend merges, backend `companies` table holds two distinct rows.
- **"Anthropic" vs "Anthropic with typo".** The `CANONICAL` map does not contain typo entries. Wikidata's `wbsearchentities` may return the correct entity for a typo (its fuzzy search is decent), but the CACHE key is the raw misspelled string - so the cache stores `{"name": "Antrhopic", "is_company": true}`. The misspelled name flows into `companies.name` and `articles.companies` and is never reconciled with the correctly-spelled row.

### 2.4 Frontend layer (display-time only)

- `canonicalize(name: string): string` (`src/lib/company-intel.ts:409-423`) - strips trailing `.,`, lowercase-keys, looks up in `CANONICAL`. If miss, runs `LEGAL_SUFFIX_RE` to strip suffix and re-lookups. Returns the original or stripped string if no map hit.
- `dedupeAndMapApiCompanies()` (`src/app/company/page.tsx:55-74`) - sums `mention_count` across rows that canonicalize to the same name. **This is the only place duplicate counts are reconstructed for the user.**
- `isJunkEntityName()` (`company-intel.ts:383-403`) - additional defense-in-depth at render time: blocks junk words, currencies, countries, gov bodies, law firms, indexes, named individuals, abstract phrases. Keeps the list page clean even when DB rows survive ingestion.

**Architecture observation.** The system has two parallel canonicalization layers - **backend (blocklist + Wikidata, no name unification)** and **frontend (CANONICAL map + suffix stripper, display-time merge)** - and they don't share state. The frontend's `CANONICAL` map cannot be relied on to make `articles.companies.contains([name])` or `watchlist_articles.identifier == name` queries return correctly - both are case- and casing-sensitive against the raw stored value.

---

## 3. Duplicate inventory (derived from code, not live SQL)

**Audit cannot run live `SELECT` - no Supabase credentials available in this worktree.** The classes of duplicates the code admits (and which prior diagnosis docs confirm exist in prod) are:

### Class A - Legal-suffix variants (the most common)

The backend `upsert_company` does no suffix stripping. Every Gemini emission of "Acme Inc", "Acme Corp", "Acme", "Acme, Inc.", "Acme Holdings" produces a separate `companies` row.

Examples the canonical map admits exist (because it explicitly maps variants):
- "Apple", "Apple Inc", "Apple Inc."
- "Microsoft", "Microsoft Corp", "Microsoft Corporation"
- "Alphabet", "Alphabet Inc", "Alphabet Inc.", "Google", "Google LLC", "Google Inc"
- "Meta", "Meta Platforms", "Meta Platforms Inc", "Meta Platforms, Inc.", "Facebook"
- "Amazon", "Amazon.com", "Amazon.com Inc", "Amazon.com, Inc."
- "Anthropic", "Anthropic PBC"
- "Robinhood", "Robinhood Markets", "Robinhood Markets Inc"
- "Goldman Sachs", "Goldman Sachs Group", "The Goldman Sachs Group", "Goldman"

Class A duplicates fragment `mention_count` across rows. The "top companies by mention" query in `/api/companies` orders by `mention_count` and so under-counts every well-known multi-variant brand. [unverified - would need a live `SELECT name, mention_count FROM companies WHERE name ILIKE '%apple%' ORDER BY mention_count DESC` to count]

### Class B - Domain variants

Examples observed by the user: "anthropic.com" vs "anthropic.io". Could also include "stripe.com", "openai.com" if Gemini extracts URL-like strings. Nothing in the pipeline strips a TLD before inserting.

### Class C - Whitespace and punctuation variants

NBSP (U+00A0), trailing `.`, trailing `,`, double-spaces inside the name. Code never NFC-normalizes, never collapses internal whitespace, only ASCII-strips edges.

### Class D - Casing variants

Gemini sometimes emits `"OPENAI"` in a headline-derived extraction, `"OpenAI"` from a body extraction, `"Openai"` from a table-of-contents derived extraction. `upsert_company` is case-sensitive: three rows result.

### Class E - Typo variants

No typo-tolerant matching. Wikidata search may return the right description, so the `wikidata_entity_cache` row exists with `is_company=true` for the misspelled string, but the misspelling is then propagated into `companies` and `articles.companies` as the canonical name for that ingestion. Subsequent ingestions of the correct spelling create a separate row.

### Class F - Junk entities that survive Wikidata "ambiguous → keep"

Documented in Noah's prior `COMPANY_INTEL_DEEP_DIAGNOSIS.md` and the `2026-04-29-cleanup-junk-companies.sql` migration: "TechCrunch", "Bloomberg", "Crunchbase", "YouTube", "Federal Reserve", "Pentagon", "Iran" all survived the entity quality pipeline. The cleanup migration deleted these seven specific values; the `companies_name_no_junk` CHECK constraint added 2026-04-30 prevents re-introduction of those same seven names only - broader categories are not blocked. Wikidata's `_classify` returning `None` (ambiguous → keep) is the structural cause; new junk in this class will appear and require new one-off cleanups until the keep-by-default policy is reversed.

### Class G - Watchlist identifier vs companies.name mismatches

Watchlist `identifier` for a `type='company'` entry is whatever the user typed (or whatever Clearbit returned). It is **not** matched against `companies.name`. So a user adding "Stripe" to their watchlist does not get connected to any "Stripe" row in `companies` even when one exists, and is never connected to "Stripe Inc" or "stripe.com" even via fuzzy match.

---

## 4. Watchlist join behavior (why "Stripe" fails)

This is the dependency root for W2-B (watchlist unified search).

### 4.1 What runs when a user types "Stripe" into the watchlist add input

1. **Component:** `src/components/watchlist/WatchlistAddInput.tsx`. Mode `company` is the relevant tab (Stripe is private, no ticker).
2. **Autocomplete fetch:** Lines 102-118 - debounced 300ms hit to `/api/company-search?q=Stripe`.
3. **`/api/company-search/route.ts:9-30`:** **Calls Clearbit's autocomplete API** (`https://autocomplete.clearbit.com/v1/companies/suggest?query=Stripe`). Returns up to 8 `{name, domain}` suggestions. **Does not consult Supabase `companies` at all.** Does not consult `wikidata_entity_cache`. Does not consult any internal alias map.
4. If Clearbit returns nothing or errors, the component shows an "Add 'Stripe' as private company" fallback (lines 387-404). The string the user typed is sent verbatim to the watchlist `POST` endpoint.
5. **`/api/watchlist/route.ts:55-143` POST:** Inserts `{identifier: "Stripe", type: "company", display_name: "Stripe", user_id: ...}` into `watchlist`. Case-insensitive duplicate check is per-user only (lines 86-101), so two users can each have their own Stripe row, and the same user can't add it twice.

### 4.2 What happens when the user opens the Watchlist page expecting Stripe articles

1. **`src/app/watchlist/page.tsx:fetchArticlesForEntry()` (lines 261-354):**
   - For `type='company'`, with entry age > 60 minutes, tries the cache first: `fetchCachedArticles(entry.identifier)` reads `watchlist_articles WHERE identifier = 'Stripe'` (case-sensitive `.eq`).
   - On cache miss, falls through to `buildArticleOrFilter(entry.identifier, displayNameForSearch, 'company')` (`src/lib/watchlist-utils.ts:99-127`).
2. **`buildArticleOrFilter`:** For a company-type entry the displayNameForSearch is `null`, so terms = ["Stripe"]. Builds OR clause `primary_company.ilike.%Stripe%,title.ilike.%Stripe%` against `articles`. Note the comment at `watchlist-utils.ts:91-92`: **"the `companies` column is a PostgreSQL text[] array; PostgREST does not support .ilike on array columns, so it is intentionally excluded."** That means an article with `articles.companies = ["Stripe"]` and `primary_company = NULL` and `title = "Klarna files IPO"` would NOT match.
3. **GDELT fallback** (lines 337-351): if fewer than 3 results came back, hit `/api/news-search?q=Stripe`. This is a generic news search, not entity-resolution.
4. **Watchlist sync (backend):** `backend/watchlist_sync.py:649-711 sync_identifier()` runs nightly across all distinct watchlist identifiers. For `type='company' identifier='Stripe'`, it fires Finnhub (which fails - Stripe has no ticker), Exa (`{"query": "Stripe news"}`), and GDELT. Whatever those services return is upserted under `identifier='Stripe'`. Articles appear in `watchlist_articles` keyed by `identifier='Stripe'`.

### 4.3 Why "Stripe" appears unfindable on the Ticker tab

The Ticker tab (`type='ticker'` in `WatchlistAddInput`) calls `/api/finnhub-search?q=Stripe`. `src/app/api/finnhub-search/route.ts:36-39` filters Finnhub results to `type === 'Common Stock' || type === 'ETP'`. **Stripe is not publicly traded, has no Finnhub Common Stock entry, and is filtered out before the dropdown renders.** The user sees "no results" and concludes the search is broken.

The fix Noah is implicitly asking for in W2-B is a unified search that:
- Tries Finnhub for tickers
- Tries Clearbit / internal `companies` table for private companies
- Surfaces the Clearbit hit on the Ticker tab too (or removes the artificial Ticker/Company tab split)

W2-A unblocks this by giving the backend a stable canonical entity row that both lookups can resolve to - instead of needing two separate API roundtrips with two different display formats.

### 4.4 Symptoms in production today

- Users typing "Stripe" on the Ticker tab see "Ticker not found." (`route.ts:120-123`).
- Users typing "Stripe" on the Company tab see Clearbit results (Stripe Inc, etc.) and can add the entry, but the article feed is sparse because Finnhub returns nothing and Exa coverage is uneven.
- The "Stripe" they tracked is not connected to the "Stripe", "Stripe Inc", or "stripe.com" rows in `companies` (if any exist). When the Morning Brief runs `fetch_watchlist_signals()` (`backend/synthesize.py:649-713`), it queries `watchlist_articles WHERE identifier IN (...)` - case-sensitive - and the watchlist signal block in the prompt uses `identifier='Stripe'` literally. Brief mentions are anchored to that string, never reconciled with the brand entity.

---

## 5. Memo title behavior (does the typo'd Anthropic flow into the memo header?)

Trace from "Generate Memo" click on a Company Intel detail page through to rendered memo title.

1. **Detail page entry:** `src/app/company/[id]/page.tsx`. The URL slug (e.g. `/company/anthropic` or `/company/anthropic-pbc`) is converted by `slugToCompanyName(slug)` (lines 19-28). **This function does a CANONICAL lookup before title-casing.** So `/company/anthropic` and `/company/anthropic-pbc` and `/company/anthropic-with-typo` would all resolve as follows:
   - `anthropic` → `CANONICAL["anthropic"]` is not present (only "anthropic pbc" → "Anthropic" is mapped at line 142). Falls through to title-case: `"Anthropic"` ✓
   - `anthropic-pbc` → `CANONICAL["anthropic pbc"]` → `"Anthropic"` ✓
   - `anthropic-with-typo` (e.g. "antrhopic") → no CANONICAL hit → title-cased to "Antrhopic"
2. **Header render:** `companyName` flows into `<CompanyDetailClient companyName={companyName} ... />`. The header in `src/components/company/company-detail-client.tsx:58-60` renders `<h1>{companyName}</h1>` directly. No second canonicalization.
3. **Memo system prompt:** `buildMemoSystemPrompt(companyName)` (`src/lib/company-intel.ts:728-796`) bakes the company name into the prompt repeatedly (e.g. line 759: `"Sector momentum [supports / does not support / ...] ${companyName}'s ..."`).
4. **Memo modal:** `MemoModal` opens with `title={companyName}` (`src/app/company/page.tsx` and detail page). `MemoModal.tsx:236-238` renders `<h2>{title}</h2>`. **The title rendered in the modal header is whatever was passed in - i.e. the slug-derived name.**

### 5.1 The problem path in production

If the user visits `/company/<exact-name-from-companies-table>` and the slug came from a junk row like "Antrhopic" (typo), the memo header reads "Antrhopic" and the memo system prompt asks Gemini to opine on "Antrhopic" - no cross-check against `CANONICAL`, no Wikidata lookup, no fuzzy match to the canonical "Anthropic" row.

The list page (`src/app/company/page.tsx:567-574`) generates company links by canonicalizing first, so a user clicking from the list will land on a canonicalized slug. But the path is not tamper-proof. Direct deep links and any external surface using the raw `companies.name` will pass the raw string to the memo.

### 5.2 Where canonical name SHOULD be substituted

- `slugToCompanyName()` should canonicalize on lookup (it partially does - needs the full backend canonical map, not just the small frontend dict).
- `MemoModal title` should derive from the canonical name, not the slug.
- The memo prompt (`buildMemoSystemPrompt`) should use the canonical name in every `${companyName}` interpolation.
- The article filter (`fetchCompanyArticles` in `src/app/api/companies/[id]/articles/route.ts`) already uses `canonicalize()` (line 88) before querying, so articles will not be missed even when the slug is non-canonical. **This is the only existing consumer that does the right thing.**

The full fix needs the backend to expose a canonical-entity ID so the memo title, prompt, and article query all resolve through the same source of truth.

---

## 6. Migration scope estimate

Strategy assumed: **alias table + canonical_id FK swap.** "Big bang" full rebuild from QIDs is in §8.

### 6.1 New tables

- `entities` (or rename `companies`): `id (uuid PK, stable across renames)`, `canonical_name (text NOT NULL)`, `wikidata_qid (text NULLABLE, indexed)`, `ticker (text NULLABLE, indexed)`, `sector (text)`, `mention_count (int)`, `last_updated`. Single row per real entity.
- `entity_aliases`: `id (uuid PK)`, `entity_id (uuid FK → entities.id)`, `alias (text NOT NULL, indexed, citext or normalized lower)`, `source (enum: 'wikidata'\|'manual'\|'gemini'\|'clearbit'\|'finnhub')`, `confidence (float)`, `created_at`. UNIQUE(alias). One row per known variant.

### 6.2 Tables that need a new FK column

- `articles.primary_company_id (uuid FK → entities.id)` - alongside the existing `primary_company` text column for backfill safety.
- `articles.company_ids (uuid[])` - alongside `articles.companies`.
- `company_mentions.entity_id (uuid FK → entities.id)` - alongside `company_id`.
- `watchlist.entity_id (uuid FK → entities.id NULLABLE)` - only for `type='company'` and `type='ticker'`. Sector entries don't need it.
- `watchlist_articles.entity_id (uuid FK → entities.id NULLABLE)`.
- `theses.primary_entity_id (uuid FK → entities.id NULLABLE)` - optional, plus keep `top_companies` jsonb for now.
- `trend_clusters.top_entity_ids (uuid[] NULLABLE)`.
- `deal_flow.target_entity_id` and `deal_flow.acquirer_entity_id` - optional, deal layer is most divergent.

### 6.3 Backfill logic required

- For each existing `companies` row: canonicalize via the frontend `CANONICAL` + `LEGAL_SUFFIX_RE` logic, group rows that map to the same canonical name, pick the row with highest `mention_count` as the survivor, sum `mention_count`s, merge `key_themes` arrays, copy non-survivor IDs into a "merged" mapping table for FK rewrites.
- For each survivor, look up Wikidata QID via `wbsearchentities` and store on `entities.wikidata_qid`.
- For every `articles.companies` array: rewrite each element to canonical form (via the merged mapping), populate `articles.company_ids` from `entity_aliases`.
- For every `articles.primary_company` text: lookup → `articles.primary_company_id`.
- For every `company_mentions.company_id`: rewrite via merged mapping → `entity_id`.
- For every `watchlist.identifier` of `type='company'`: lookup against `entity_aliases`, populate `watchlist.entity_id` where match, leave NULL where no match (manual triage queue).
- For `watchlist_articles.identifier`: same lookup pattern.

### 6.4 Irreversible operations (and how to reverse)

- **Merging two `companies` rows.** Reversible only if you keep the pre-merge name list in `entity_aliases` AND keep a `merge_log` table recording which rows got collapsed into which survivor (e.g. `merge_log: source_row_id, target_entity_id, merged_at, merge_reason`). Then a merge can be split back by re-creating an entity from the alias log.
- **Dropping `companies.id` keys after FK swap.** Don't. Keep both columns (`company_id` and `entity_id`) on `company_mentions` for at least one quarter so a rollback is just a `UPDATE` away.
- **Rewriting `articles.companies` text array.** Keep the original column under `articles.companies_raw` until the new `articles.company_ids` has been validated against a sample of memos and watchlist queries.

### 6.5 Estimated scope

| Surface | Lines of code or rows touched |
|---|---|
| New schema (entities + entity_aliases + indexes + RLS) | ~150 lines SQL |
| Backfill SQL + Python script (canonicalize, group, lookup Wikidata) | ~400 lines |
| `backend/ingest.py` updates (write entity_id alongside name) | ~30 line diff in `store_article` and `upsert_company` |
| `backend/watchlist_sync.py` (resolve identifier → entity_id) | ~20 line diff |
| `backend/synthesize.py` (resolve watchlist identifiers via entity_id) | ~30 line diff |
| Frontend `/api/companies` and `/api/watchlist` (return entity_id, dedupe server-side) | ~80 line diff |
| `src/lib/company-intel.ts` (move CANONICAL lookup to a server-side endpoint, keep client copy as fallback) | ~50 line diff |
| Watchlist add input (unified search using entity_aliases) | ~100 line diff |
| Memo title canonicalization (MemoModal, slugToCompanyName) | ~20 line diff |
| Cleanup migration (remove duplicate `companies` rows) | ~40 lines SQL |

**Order of operations to make it safe:**
1. Ship `entities` and `entity_aliases` empty, with NULLABLE FKs added to all consuming tables. No code reads them yet.
2. Run backfill in a one-off script. Verify row counts. Verify a hand-picked set of canonicalizations.
3. Switch readers (frontend and backend) to read entity_id when present, fall back to the legacy text column. Ship behind a feature flag if possible.
4. Switch writers to populate both. Ship.
5. Observe for 1-2 weeks.
6. Remove duplicate `companies` rows. Drop legacy text columns last, and only after backups.

---

## 7. Lucas coordination flag

The audit touches code Lucas has been editing per `docs/HANDOFF.md`. Any W2-A work needs explicit Lucas sign-off on the following surfaces before merge:

- **`backend/synthesize.py`.** Lines 649-713 (`fetch_watchlist_signals`) and lines 1130-1170 (watchlist injection block) read identifiers literally and inject them into the brief prompt. If W2-A introduces an entity_id resolution layer, `fetch_watchlist_signals` must change. Lucas merged Lead Selection / Filter A2 (PRs #129, #135) into this file recently and is the owner of the broader synthesis flow.
- **`backend/ingest.py`.** Lines 254-271 (`is_blocked_entity`), 307-332 (`extract_company_names`), 631-650 (`upsert_company`), 661-721 (`store_article`) are the entire entity write path. PRs #79-#82 (entity quality pipeline) are Lucas's. Any change to insertion semantics is touching code with three months of recent prompt and gate iteration.
- **`backend/wikidata.py`.** Owned by the entity quality pipeline. If W2-A changes the keep-by-default policy or adds canonical-name unification at the cache layer, that's a meaningful behavior change Lucas should review.
- **`src/lib/company-intel.ts`.** Frontend canonicalization logic. Heavily extended in PR #150 (Company Intel structural fix, 2026-04-29). Any move toward a server-side canonical map needs Lucas's input on what stays in TS as the cache and what moves to the database.
- **`backend/deal_extractor.py`.** Lucas's deal extraction layer. Likely needs entity_id integration too, but is downstream of the W2-A scope. Note for W2-A: leave deal_flow alone in v1, plan deal_flow integration as v2.

**Recommendation:** before W2-A coding starts, send Lucas a 5-line message naming these files and asking for a hold on changes for the W2-A window (estimated 2-3 days). Otherwise expect merge conflicts on `synthesize.py` and `ingest.py` again, like the lead-preselect work last week.

---

## 8. Recommended approach - three candidate strategies

### Strategy A - Alias table + canonical_id FK swap (RECOMMENDED)

**What it is.** Build `entities` and `entity_aliases` as net-new tables. Backfill from existing `companies`. Add NULLABLE `entity_id` FKs to consuming tables (articles, company_mentions, watchlist, watchlist_articles, theses, trend_clusters). Migrate readers and writers behind a feature flag. Remove duplicates last, after observation.

**Cost.**
- ~400 lines of new SQL + ~600 lines of new Python/TS code (per §6.5).
- 2 to 3 focused engineering days, plus 1 to 2 weeks of observation before duplicate removal.
- Wikidata QID lookups are rate-limited (`backend/wikidata.py:_REQUEST_DELAY = 0.15`). Backfilling several hundred entities takes a few minutes serially.

**Risk.**
- Backfill mismatches (e.g. "Apple" the fruit company vs Apple Inc) require human review. Mitigation: stage the entity_id population with a manual confirmation step for low-confidence Wikidata matches.
- FK additions are safe (NULLABLE), but `articles.company_ids` rewrites are bulk UPDATEs against a hot table. Run during low-traffic window. Mitigation: do in batches of 1000 with progress logging.
- The frontend `CANONICAL` map will diverge from the server `entity_aliases` if both are maintained independently. Mitigation: ship a `/api/entities/aliases` endpoint that the frontend pulls at build time, replacing the static `CANONICAL` map.

**What it unlocks.**
- **W2-B (watchlist unified search):** the search input queries `entity_aliases` once and returns a single `entity_id`. Tickers and private companies both resolve through the same path. Stripe becomes findable.
- **W2-C (memo CTA promotion):** the memo button passes `entity_id`, the memo title and prompt always use `entities.canonical_name`, no more typos in headers.
- **W2-H (live feed dedupe):** dedup uses `articles.company_ids` overlap instead of fuzzy title comparison. Two articles about Anthropic-with-and-without-suffix collapse to one feed row.

**Reversibility.** Best in class. Drop the new columns, drop the new tables, the legacy text columns are still populated. No data lost.

### Strategy B - In-place dedupe with merge logic

**What it is.** No new tables. Add a `companies.canonical_name` text column. Run a one-off backfill that sets `canonical_name` on every row using the existing frontend `CANONICAL` + `LEGAL_SUFFIX_RE` logic ported to Python. Add a `companies.merged_into_id` UUID column (nullable, self-FK). Mark all but the survivor row in each merge cluster with `merged_into_id = survivor_id`. Update reader queries to follow `merged_into_id`. Eventually delete the merged-into rows.

**Cost.** ~150 lines SQL + ~200 lines Python. 1 day. Simpler than Strategy A.

**Risk.**
- **No alias table means no place to record "this string maps to this entity but isn't the canonical name."** New ingestion still inserts new rows for new variants; the merge-into pattern handles them only at next backfill run.
- Watchlist `identifier` and `articles.companies` text array still hold raw strings. Display dedup works, server-side unification doesn't.
- Less reversible: deleting "merged-into" rows breaks any external references to those `id`s.
- Doesn't unblock W2-B's "find Stripe by any string" requirement - there's no alias index.

**What it unlocks.** Partial fix for the "anthropic vs anthropic.com" display problem. Doesn't structurally fix the watchlist join.

**Verdict.** Cheaper, but leaves the cause of the problem in place. Recommended only if Wave 2 needs a 1-day patch and a longer-term entity rebuild is queued for Wave 3.

### Strategy C - Rebuild from scratch using Wikidata QIDs as primary key

**What it is.** Drop `companies` (after backup). Create `entities` with `wikidata_qid (text PK)`. Re-ingest the last 90 days of articles, calling Wikidata at extraction time and writing QIDs into `articles.entity_qids (text[])`. Watchlist identifiers resolved to QIDs at add time. Frontend reads QID-keyed entities everywhere.

**Cost.** ~3 days for the rewrite. ~6 hours of pipeline runtime to re-extract 90 days of articles (Wikidata rate limit dominates). High coordination overhead because this changes the schema for everything downstream of `articles`.

**Risk.**
- **Wikidata coverage is incomplete for private companies and recent startups.** Stripe has a QID. "AfterQuery" (a real watchlist entry per the dedup migration) probably does not. Need a fallback identifier scheme for QID-less entities, which reintroduces all the alias problems Strategy A was supposed to solve.
- Re-ingestion of 90 days of articles will produce different `relevance_score` outputs from Gemini (model is non-deterministic), so historical thesis grading and brief feedback metrics will shift slightly. Could invalidate live_score backtests.
- Reversibility: low. The old `companies.id` UUIDs are gone, references break.
- Lucas's recent entity quality pipeline work (PRs #79-#82) was specifically designed around the keep-by-default policy and the existing `companies` schema. A from-scratch rebuild walks back that investment.

**What it unlocks.** A clean schema, with the canonical key being Wikidata's. Best long-term answer if the product survives long enough for someone to maintain it.

**Verdict.** Right answer for a Wave 4 or Wave 5. Wrong answer for W2-A given the timeline pressure and the coupling to W2-B/C/H. Strategy A is the W2-A pick.

---

## 9. Verification commands the next session should run with live access

(For when Noah opens this with prod credentials in his shell. Read-only.)

```sql
-- Top duplicate clusters by canonical-prefix grouping (rough approximation)
SELECT
  LOWER(REGEXP_REPLACE(name, '\s+(Inc|Corp|LLC|PLC|Ltd|Holdings|Group|Markets|Platforms|Technologies|, Inc\.?|, Corp\.?)$', '', 'i')) AS rough_canonical,
  COUNT(*) AS variant_count,
  SUM(mention_count) AS total_mentions,
  ARRAY_AGG(name ORDER BY mention_count DESC) AS variants
FROM public.companies
GROUP BY 1
HAVING COUNT(*) > 1
ORDER BY total_mentions DESC
LIMIT 20;

-- Watchlist identifiers that don't appear in companies.name
SELECT DISTINCT w.identifier, w.type
FROM public.watchlist w
WHERE w.type IN ('company', 'ticker')
  AND NOT EXISTS (
    SELECT 1 FROM public.companies c
    WHERE LOWER(c.name) = LOWER(w.identifier)
       OR LOWER(c.ticker) = LOWER(w.identifier)
  )
ORDER BY w.identifier;

-- articles.companies entries that produced a wikidata_entity_cache "ambiguous" verdict
SELECT name, wikidata_description
FROM public.wikidata_entity_cache
WHERE is_company IS NULL
ORDER BY name
LIMIT 50;

-- Names with non-ASCII characters (NBSP, smart quotes, Unicode whitespace)
SELECT name, mention_count
FROM public.companies
WHERE name ~ '[^\x20-\x7E]'
ORDER BY mention_count DESC
LIMIT 20;

-- Per-domain duplicate detection
SELECT
  REGEXP_REPLACE(LOWER(name), '\.(com|io|ai|co|org|net)$', '') AS stripped,
  ARRAY_AGG(name) AS variants,
  COUNT(*) AS variant_count
FROM public.companies
WHERE name ~ '\.(com|io|ai|co|org|net)$'
GROUP BY 1
HAVING COUNT(*) > 0
ORDER BY variant_count DESC;
```

These four queries will produce the live duplicate inventory §3 could not. Two of them (`stripped` domain query, NBSP query) directly verify the specific failure modes Noah named.

---

## 10. Audit hygiene

- Read-only confirmed. No `INSERT`, `UPDATE`, `DELETE`, `ALTER`, `DROP` issued.
- No code changes. Verified with `git status` showing only `docs/entity-resolution-audit.md`.
- `backend/synthesize.py` and `backend/ingest.py` were read at line ranges 1060-1170, 649-713, 109-204, 254-332, 631-721 - no edits.
- Em-dashes avoided per house style.
- Provenance flagged on every section that would need live SQL to fully verify.
