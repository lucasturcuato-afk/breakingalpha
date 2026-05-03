# W2-A: Entity Resolution Design

Author: Noah Hanning. Date: 2026-05-03. Status: locked. Co-founder Lucas signed off on Strategy A and the 5 architectural invariants below. This doc is for the team (Noah, Lucas, future contributors); it documents what is being built and why. Implementation lands in a follow-up PR.

### 1. Problem statement

Production today fragments entities at three layers (write, read, watchlist), and the symptoms are quantifiable.

**Top-20 dupe clusters split ~500 mentions across the biggest brands.** Concrete examples:

- NVIDIA: 81 mentions split 3 ways (Nvidia, NVIDIA, Nvidia Corp)
- Meta: 95 mentions split 2 ways (Meta, Meta Platforms)
- Google: 74 mentions split 2 ways (Google, Google LLC)
- Tesla: 60 mentions split 2 ways

Every leaderboard, mention count, and per-company memo is wrong by the size of the split.

**52 watchlist entries do not resolve to any companies row.** This includes the most-watched tickers (AAPL, AMZN, GOOG, GOOGL, NVDA, ORCL, TSM, V, GS, BA, XOM), real private-company entries (AlphaSights, Perplexity AI), and at least one user typo ("APPL"). The watchlist UI shows results that the rest of the app cannot link to.

**Wikidata "ambiguous → keep" pollution.** The current behavior in `backend/wikidata.py` treats `is_company IS NULL` as keep (lines 131 and 160 both return `is_co is not False`). The 50-row `LIMIT` was hit on letter A alone. Examples that made it through to `companies`: "Ackermann" (family name), "ACP" (scientific journal), "Aidoc" (genus of insects), "Ajax" (web framework), "Affinia" (village in Senegal), "Alcami" (model hallucination, no real entity).

**Unicode contamination.** "Moody's Analytics" (curly apostrophe) and "Moody's Analytics" (straight) do not deduplicate. Same problem for Estée Lauder, Hermès, Crédit Agricole. Plus "Alphabet Inc.'s Google" (possessive parsed as a company), "Permag™" (TM symbol embedded in name).

**Routing problem (the read-path consequence).** Typing "Perishing Square" on Company Intel falls through `src/app/api/companies/route.ts:48` (a bare `ilike` on `name`) into `web-fallback`. That fires a Gemini memo at $0.005 to $0.035 per call for an entity that already exists indexed (Pershing Square, 5 mentions; Pershing Square USA, 1 mention). Same root cause as the dedup problem, hitting the routing layer.

### 2. Strategy A: locked architecture

Five invariants. These are non-negotiable; they bound the implementation surface for this PR.

> **Invariant 1: Ingest writes to alias.surface_form, never directly to companies.**
> The `companies` row is the canonical record only. New names enter through `aliases.surface_form` and resolve to a `canonical_id` either on read (via JOIN) or via a thin write-time resolver. Direct writes to `companies` from ingest are removed.
> Without this, every fix downstream is a band-aid: the same string keeps inserting new canonical rows on every variant.

> **Invariant 2: Unicode normalization happens at alias insert time, not at companies.**
> The `aliases.surface_form` column stores the raw string the article actually used. The lookup key (`aliases.lookup_key`) is the NFKC-normalized, apostrophe-folded, lowercased form. Resolution is by `lookup_key`; rendering uses `surface_form` or the canonical `companies.name`.
> If we normalize on the canonical row instead, we lose the raw evidence and the same problem moves one table over the moment we add a new alias source.

> **Invariant 3: The Wikidata keep-by-default flip ships in this PR.**
> `backend/wikidata.py` currently treats `is_company IS NULL` as keep. We flip to drop. The cleanup script that hard-deletes existing polluted `companies` rows (joined against `wikidata_entity_cache.is_company IS NULL`) ships in the same PR. No follow-up.
> Splitting these introduces a window where ingest is dropping new pollution but old pollution still ranks on leaderboards. We pay the migration cost once.

> **Invariant 4: Watchlist backfill for the 52 unresolved entries ships the same week.**
> Static ticker -> canonical_id mapping (AAPL -> Apple Inc, AMZN -> Amazon.com, etc.), inserted as alias rows pointing to existing canonical companies; new canonical rows for entities not yet indexed (AlphaSights, Perplexity AI). Includes the typo "APPL" as an alias to the same canonical_id as AAPL. See section 8 for whether this is the same PR.
> Without it, the watchlist UI continues to show 52 stub entries that nothing else in the app can link to. Lucas locked the same-week deadline.

> **Invariant 5: Ambiguity tiebreak in V1 is highest mention_count.**
> When `aliases.lookup_key` matches multiple `canonical_id` values, we return the one with the highest `companies.mention_count` (denormalized for query speed; see schema). Every ambiguous resolution writes a row to `resolution_log` so we can measure how often this fires before V2.
> V2 (a disambiguation modal, per-user resolution state, and telemetry) is a real product feature, not a tiebreak rule. We do not build V2 inside W2-A.

### 3. Schema

Two new tables. No schema changes to `companies` (behavior change only: it becomes canonical-only, no longer the destination of ingest writes).

**`aliases`**

| column | type | notes |
| --- | --- | --- |
| id | uuid pk, default gen_random_uuid() | |
| surface_form | text NOT NULL | raw string as it appeared in the source |
| lookup_key | text NOT NULL | NFKC + apostrophe-folded + lowercased; see section 6 |
| canonical_id | uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE | |
| mention_count | integer NOT NULL DEFAULT 0 | denormalized from companies for tiebreak query speed; refreshed when ingest increments the canonical row |
| created_at | timestamptz NOT NULL DEFAULT now() | |
| last_seen_at | timestamptz NOT NULL DEFAULT now() | bumped each time the alias resolves a new mention |

Constraints:
- `UNIQUE (lookup_key, canonical_id)` so the same alias cannot point to the same canonical twice
- `INDEX aliases_lookup_key_idx ON aliases (lookup_key)` for the read-path JOIN

`mention_count` lives on `aliases` (not as a view) because the tiebreak path runs on every ambiguous resolution and a JOIN to `companies` per call is wasted work for a value that changes only on ingest. Refresh strategy: `register_entity` in `backend/ingest.py` updates `aliases.mention_count` for the resolved row in the same transaction as `companies.mention_count`. No trigger.

**`resolution_log`**

| column | type | notes |
| --- | --- | --- |
| id | uuid pk, default gen_random_uuid() | |
| surface_form | text NOT NULL | what the caller passed in |
| lookup_key | text NOT NULL | post-normalization |
| resolved_canonical_id | uuid REFERENCES companies(id) ON DELETE SET NULL | null when resolution missed entirely |
| candidate_canonical_ids | jsonb NOT NULL DEFAULT '[]'::jsonb | array of all matching canonical ids when ambiguous |
| was_ambiguous | boolean NOT NULL DEFAULT false | true when len(candidates) > 1 |
| created_at | timestamptz NOT NULL DEFAULT now() | |

Used for V2 trigger analysis (see section 10). One row per resolution call; small enough to keep indefinitely without partitioning at our current volume.

**`companies`**: no schema changes. The existing `UNIQUE (name)` constraint stays. Behavior change: the row is created and updated only by the canonical-creation branch of `register_entity`; nothing else writes to it.

### 4. Read-path resolution: JOIN vs materialized view

We use a JOIN with `INDEX aliases_lookup_key_idx`. No materialized view in V1.

Justification:
- `companies` has 2,870 rows today. The largest plausible JOIN scans `aliases` (a few thousand rows after backfill) against an indexed lookup key. This is sub-millisecond on Supabase Postgres.
- A materialized view introduces staleness windows and refresh-job operational overhead. We have no measured query that exceeds latency budgets today.
- Reversibility: switching from JOIN to MV later is a one-PR migration. Switching the other way is harder because callers grow to depend on MV semantics.

We revisit if any of the following becomes true: `companies` exceeds 100k rows; a hot-path read on Company Intel exceeds 50ms p95 due to the JOIN; or we add a use case that needs a denormalized canonical-name view (e.g., per-user resolution preferences).

### 5. Write-path migration

Today, `backend/ingest.py:631-650` is `upsert_company(name, themes, sentiment) -> id`. It does a SELECT on `companies.name`, then either UPDATE (mention_count + 1) or INSERT. No normalization. No alias awareness.

After W2-A, ingest calls `register_entity(surface_form, themes, sentiment) -> canonical_id`. The new function:

1. Compute `lookup_key = normalize_lookup_key(surface_form)` (section 6).
2. SELECT `canonical_id, mention_count` FROM `aliases` WHERE `lookup_key = $1`.
3. If exactly one row: increment `companies.mention_count` and `aliases.mention_count` for that `canonical_id`, set `aliases.last_seen_at = now()`, return `canonical_id`.
4. If multiple rows: pick the row with the highest `mention_count` (the V1 tiebreak rule), increment that row's counts, write a `resolution_log` row with `was_ambiguous = true` and the full candidate list, return the chosen `canonical_id`.
5. If zero rows: INSERT a new `companies` row with `name = surface_form`, INSERT an `aliases` row pointing to it (`surface_form` raw, `lookup_key` normalized, `mention_count = 1`), write a `resolution_log` row with `was_ambiguous = false`, return the new `canonical_id`.

Steps 3, 4, and 5 each run in a single transaction. Step 5 uses `INSERT INTO companies (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING id` to handle the existing `UNIQUE (companies.name)` constraint. If `RETURNING` is empty (another worker won the race), SELECT the existing `canonical_id` by name and re-enter at step 2. No advisory locks; the unique constraint is the synchronization primitive.

Lucas implements this in the follow-up PR. This doc specifies the function-level contract; not the line-by-line edit.

### 6. Unicode normalization spec

```python
import unicodedata

def normalize_lookup_key(s: str) -> str:
    # Strip trademark/registered/copyright symbols before NFKC.
    # NFKC decomposes ™ to "TM" which would concatenate to the preceding
    # token (Permag™ -> permagtm), defeating dedup. Strip them first.
    s = s.replace("™", "").replace("®", "").replace("©", "")
    s = unicodedata.normalize("NFKC", s)
    s = s.replace("’", "'").replace("‘", "'")  # curly single quotes -> straight
    s = s.replace("“", '"').replace("”", '"')  # curly double quotes -> straight
    s = s.strip().lower()
    return s
```

NFKC handles full-width-to-ASCII conversions for any CJK-source text and most ligature decompositions. It does NOT collapse smart quotes to straight quotes (handled by the explicit replace calls above) and it decomposes ™ to "TM" rather than removing it (handled by the explicit symbol strip before NFKC). Accented characters like Société are preserved as-is post-NFKC; we accept that "Société" and "Societe" will not match in V1, on the grounds that the legitimate dedup cases in our prod data all involve the same accent on both sides (curly Estée vs straight Estée being the contamination, not Estée vs Estee).

Apostrophe folding is required in addition to NFKC because NFKC does not collapse U+2019 (right single quotation mark) to U+0027 (apostrophe). Same for U+2018, U+201C, U+201D.

Possessives ("Alphabet Inc.'s Google") are not stripped here. They get cleaned up via the existing entity-extraction prompt in `backend/ingest.py`; the normalizer's job is mechanical, not semantic.

This function is referenced in section 3 (`aliases.lookup_key` generation) and section 5 (write-path step 1). It also runs at read time inside `register_entity` and inside the Company Intel typo-redirect in section 9.

### 7. Wikidata flip and backfill

**Flip location.** `backend/wikidata.py:131` and `backend/wikidata.py:160`. Both currently return `is_co is not False`, which means `None` (ambiguous) maps to keep. Change both to `return is_co is True`. The `_classify()` function at lines 80-105 stays as-is; we are not changing what counts as ambiguous, only what we do with it.

**Backfill scope.** Two cleanup jobs in the same PR:

1. `wikidata_entity_cache`: rows where `is_company IS NULL` get hard-deleted. Next time those names appear in ingest, they re-classify and write the new `is_company = false` (or true) value.
2. `companies`: hard-delete rows whose `name` matches a `wikidata_entity_cache.name` with `is_company IS NULL` (pre-cleanup, captured before step 1 runs). These rows entered `companies` only because of the ambiguous-keep behavior; they are not legitimate canonical entities.

   Before running the delete, audit the FK graph pointing AT `companies` to confirm what cascades. Any FK from a user-state table (`user_events`, `watchlist`, beta-user bookmarks) means cascade-delete silently destroys user history.

   ```sql
   SELECT tc.table_name, kcu.column_name, rc.delete_rule
   FROM information_schema.table_constraints tc
   JOIN information_schema.key_column_usage kcu USING (constraint_name)
   JOIN information_schema.referential_constraints rc USING (constraint_name)
   WHERE tc.constraint_type = 'FOREIGN KEY'
     AND rc.unique_constraint_name IN (
       SELECT constraint_name FROM information_schema.table_constraints
       WHERE table_name = 'companies' AND constraint_type = 'PRIMARY KEY'
     );
   ```

   Decision rule: if any user-data table has `delete_rule = CASCADE` pointing at `companies`, switch that path to soft-delete (add `companies.deleted_at` and filter on it everywhere) instead of hard-delete. Pure system tables like `company_mentions` cascading is fine. Run this audit during implementation, not now.

**Dry-run query (run before deleting).**

```sql
SELECT COUNT(*) AS to_delete
FROM companies c
JOIN wikidata_entity_cache w ON w.name = c.name
WHERE w.is_company IS NULL;
```

Noah runs this first, confirms the count is in the expected range (likely a few hundred based on the letter-A sample), then runs the hard-delete in a transaction. If the count is materially outside the expected range, stop and investigate before deleting.

Ships in the same PR as the alias table.

### 8. Watchlist backfill

The 52 unresolved entries get backfilled in the same PR. Lucas locked the same-week deadline, and a separate PR adds review friction for what is effectively a static data load.

Approach:
1. Build a static ticker -> canonical mapping (AAPL -> Apple Inc, AMZN -> Amazon.com, GOOG and GOOGL -> Alphabet, NVDA -> NVIDIA, ORCL -> Oracle, TSM -> Taiwan Semiconductor Manufacturing, V -> Visa, GS -> Goldman Sachs, BA -> Boeing, XOM -> Exxon Mobil, etc.). Source: hand-curated list reviewed by Noah; one-time effort.
2. For each entry, look up the canonical `companies` row. If it exists, INSERT an `aliases` row pointing to it (`surface_form` = the ticker, `lookup_key` = normalized ticker). If it does not exist, INSERT a new `companies` row plus the alias row.
3. Insert "APPL" as an alias pointing to the same `canonical_id` as AAPL.
4. Insert known display-name variants (e.g., "Apple", "Apple Inc.", "Apple Inc") as aliases for the same canonical_id, picked from the existing dupe clusters in section 1.

The mapping file lives in the same PR as a Python script (or SQL seed file) so the operation is reproducible.

### 9. Company Intel typo-redirect (read-path consequence)

This is how W2-A solves the routing problem, not just the dedup problem.

**Today.** User types "Perishing Square" on Company Intel. The page calls `/api/companies?q=Perishing%20Square` (`src/app/api/companies/route.ts:48-51`), which runs `ilike("name", "%Perishing Square%")`. Zero matches because the canonical row is "Pershing Square". The frontend (`src/app/company/page.tsx:616`) then surfaces the web-fallback CTA. User clicks generate, `/api/companies/web-fallback` fires Exa plus a Gemini memo at $0.005 to $0.035, for an entity that is already indexed with mentions.

**After W2-A.** The directory search route gains one step before the existing `ilike` fallback:

1. Compute `lookup_key = normalize_lookup_key(query)`.
2. SELECT `canonical_id` FROM `aliases` WHERE `lookup_key = $1`. If hit, route the user directly to the canonical company page with article-grounded memo.
3. If miss, fall through to the existing `ilike` substring match (kept as a forgiving second layer for queries that happen to be substrings of canonical names but have no alias yet).
4. If both miss, surface the web-fallback CTA as today.

The implementation surface is small: one new helper that does the alias lookup, called from `src/app/api/companies/route.ts` before the existing query. The `normalizeFromResults` logic in `src/app/api/companies/web-fallback/normalize.ts` (PR #177) is unchanged; it still derives canonical names from web evidence when web-fallback does fire. After W2-A it fires materially less often for known entities.

### 10. Validation plan

No test infrastructure exists in this repo (confirmed in PR #177 recon). Validation is before/after queries on prod and one operational metric.

**Dupe collapse.** Should drop materially.

```sql
-- Before: count of canonical_ids that have multiple companies-rows-by-name today
-- (proxy: count names that share normalized form within the existing companies table)

-- After: count of canonical_ids with multiple aliases (expected)
SELECT canonical_id, COUNT(*) AS alias_count
FROM aliases
GROUP BY canonical_id
HAVING COUNT(*) > 1
ORDER BY alias_count DESC
LIMIT 20;
```

**Watchlist resolution rate.** Should go from (52 unresolved / total) to 0 unresolved.

```sql
SELECT COUNT(*) AS unresolved
FROM watchlist w
LEFT JOIN aliases a ON normalize_lookup_key(w.identifier) = a.lookup_key
WHERE a.canonical_id IS NULL;
```

(Implemented as a Python check since `normalize_lookup_key` is Python-side; SQL form here is illustrative.)

**Wikidata pollution.** Should be zero post-backfill.

```sql
SELECT COUNT(*) AS polluted
FROM companies c
JOIN wikidata_entity_cache w ON w.name = c.name
WHERE w.is_company IS NULL;
```

**Ambiguity rate.** Informs V2 trigger condition. Run weekly for the first month.

```sql
SELECT COUNT(*) AS ambiguous_resolutions
FROM resolution_log
WHERE was_ambiguous = true
  AND created_at >= now() - interval '7 days';
```

If this stays under 1% of total resolutions, V2 is not urgent. If it climbs past 5%, V2 (the disambiguation modal) becomes the next workstream.

**Web-fallback fire rate.** Should drop materially for known entities. We do not currently log every web-fallback fire centrally; section 9 changes ship with a counter (Vercel KV or a `web_fallback_log` table) so we can measure pre/post.

### 11. Out of scope (explicitly)

- V2 disambiguation UX: modal, per-user resolution state, telemetry surface for "user picked X over Y". Triggered by section 10 ambiguity-rate analysis.
- Bridgewater-style smart routing for split-variant entities (Bridgewater Bank vs Bridgewater Associates). Depends on the alias table; lands in a follow-up PR.
- Shared web-fallback memo cache (W2-B). Depends on stable `canonical_id` from W2-A. Separate PR.
- Company Intel UI redesign (W2-C). Separate workstream; sequenced after W2-A so the page states are locked.
- Fuzzy / phonetic search at the directory layer (e.g., Postgres `pg_trgm` or `metaphone`). Section 9 only adds exact alias-key lookup; fuzziness stays in Exa for the web-fallback path.
- Migrating `wikidata_entity_cache` itself onto the alias model. Out of scope; the cache is keyed by raw input string and that is fine.
