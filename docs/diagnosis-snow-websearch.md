# Diagnosis: indexed companies (SNOW) show an empty ArticlesTab with no web search

Recon-only. No code changed. Date: 2026-06-11. Branch: `recon/snow-websearch`.

## 1. The ArticlesTab fetch path (file, function, query)

ArticlesTab is presentational. It receives its data as a prop, it does not fetch.

- `src/components/company/tabs/ArticlesTab.tsx` takes `articles: CompanyDetailArticle[]`
  and renders `ArticlesTable`, or the empty state "No coverage in last 30 days."
  when the array is empty (ArticlesTab.tsx:33-44).
- The prop is wired in `src/app/company/[id]/page.tsx:90`:
  `articles: <ArticlesTab articles={companyDetail.articles} />`.
- `companyDetail` comes from `getCompanyDetail()` at page.tsx:65.

So the real fetch path is **`getCompanyDetail()` in `src/lib/data-access/getCompanyDetail.ts`**,
specifically the `articlesRes` query (getCompanyDetail.ts:97-104):

```
supabase
  .from("articles")
  .select(ARTICLE_COLS)
  .or(buildCompanyContainsOr(getCompanyVariants(head.name)))   // name-variant match on companies[]
  .gte("published_at", sinceArticles)                           // now - 14 days
  .order("relevance_score", { ascending: false })
  .order("published_at", { ascending: false })
  .limit(50);
```

Filter semantics:
- Match is by **company NAME variants** against the `articles.companies` JSONB array
  (`buildCompanyContainsOr(getCompanyVariants(head.name))`), not by ticker and not by entity id.
- Hard gate on **`published_at >= now - 14 days`** (`ARTICLE_DAYS = 14`, getCompanyDetail.ts:45).
- No relevance_score filter at read time.
- `head.name` is resolved from the slug by `resolveAlias()`
  (`src/lib/data-access/aliasResolver.ts`); for "Snowflake" it resolves to the
  `companies` row whose `name = "Snowflake"`.

Note: there is a second, parallel article fetcher,
`fetchCompanyArticles()` in `src/app/api/companies/[id]/articles/route.ts`
(the WD129 facet-protected, 30-day pool). The detail page calls it too
(page.tsx:78) but only to build the **memo** (`buildMemoContent`). It does NOT
feed ArticlesTab. The tab is fed solely by `getCompanyDetail().articles`.

## 2. SNOW index status and article count (evidence)

Queried against production Supabase on 2026-06-11.

SNOW is indexed:

```
SELECT id, name, ticker, mention_count, first_seen, last_updated
FROM companies WHERE ticker = 'SNOW' OR name ILIKE '%snowflake%';
-> 1 row: id 87638cce-3d6b-49f6-8444-a8ad56f42957, name "Snowflake",
   ticker SNOW, mention_count 3, last_updated 2026-04-30.
```

Tagged-article counts (companies[] contains a Snowflake variant):

```
total_tagged       = 3        (ever)
tagged_14d         = 0        (the window getCompanyDetail uses)
tagged_30d         = 0
tagged_90d         = 2
most_recent_tagged = 2026-04-30 07:28  (~42 days before today)
```

The 3 tagged rows all have healthy relevance (10, 8, 10), so a read-time
relevance gate is NOT the cause. In all three, Snowflake is a secondary
co-mention, never the sole subject:
- `{Palantir,Snowflake}` (2026-04-30, rel 10)
- `{"Palantir Technologies Inc.",Snowflake,Alphabet}` (2026-03-31, rel 8)
- `{Snowflake}` (2026-03-11, rel 10)

Coverage exists but tagging dropped it. In the last 30 days, **94 articles
mention "snowflake" in title or content, but 0 of them were tagged** into
`companies[]`:

```
SELECT count(*) AS mentions_text_30d,
       count(*) FILTER (WHERE companies::text ILIKE '%snowflake%') AS also_tagged_30d
FROM articles
WHERE (title ILIKE '%snowflake%' OR content ILIKE '%snowflake%')
  AND published_at >= now() - interval '30 days';
-> mentions_text_30d = 94, also_tagged_30d = 0
```

Why the count the ArticlesTab sees is zero: it is a compound of two things, not
a Wikidata gate or a sector filter.
1. **Thin tagging coverage.** Snowflake is almost never the primary subject of
   an article in this corpus; it surfaces as a co-mention. The entity-tagging
   step writes only the primary or clearly-salient companies, so Snowflake
   landed in `companies[]` only 3 times ever despite 94 text mentions in the
   last 30 days alone.
2. **The 14-day published_at window.** Even those 3 tagged rows are all older
   than 30 days (newest 2026-04-30). The `published_at >= now - 14d` gate in
   getCompanyDetail therefore returns 0 rows today.

## 3. Confirmed root cause (one paragraph)

SNOW is fully indexed (a `companies` row exists, ticker SNOW), so on the detail
page `getCompanyDetail()` returns a non-null `companyDetail` and the full tab
grid mounts. Its ArticlesTab is fed by `getCompanyDetail().articles`, which is a
name-variant match on `articles.companies[]` gated to `published_at >= now-14d`.
Snowflake has only 3 articles ever tagged into `companies[]` (it appears mostly
as an untagged co-mention; 94 text mentions in the last 30 days produced 0 tags),
and all 3 tagged rows are older than 40 days, so the 14-day query returns 0 rows
and the tab renders "No coverage in last 30 days." The existing Exa web-fallback
cannot rescue this case: it is invoked only from the directory/search page
(`src/app/company/page.tsx:379`) when a typed name has no index match, and it
produces a memo, not articles. On the detail page the only fallback branch is
`if (!companyDetail)` (page.tsx:70), which renders a static `EmptyState` and is
unreachable for SNOW precisely because SNOW is indexed. There is no
indexed-but-empty branch anywhere, so no web search ever fires for SNOW.

## 4. Where a read-only Exa article backfill would slot in

Goal: when an indexed company has too few in-DB articles, surface Exa results in
the ArticlesTab without writing to `articles`, `companies`, or `mention_count`.

Insertion point: `src/app/company/[id]/page.tsx`, immediately after
`getCompanyDetail()` (page.tsx:65) and before `tabContent` is built (page.tsx:88).
ArticlesTab, ArticlesTable, SourcesStrip, ThemesTab and SourcesTab all consume
`companyDetail.articles`, so injecting synthetic rows there flows through the
whole tab grid with no component changes.

Sketch (read-only, illustrative only, not applied):

```
const MIN_ARTICLES = 3;
if (companyDetail.articles.length < MIN_ARTICLES) {
  const web = await searchWeb(`${companyDetail.display} stock news`, 8); // src/lib/web-search.ts
  const synthetic = web.map(mapSearchResultToCompanyDetailArticle); // new pure mapper
  companyDetail = { ...companyDetail, articles: synthetic };
}
```

Why this respects the read-only constraint:
- `searchWeb()` (src/lib/web-search.ts:275) already persists only to the
  `web_search_cache` table (6-hour TTL). It never touches `articles`,
  `companies`, or `mention_count`. The Exa results stay ephemeral.
- The mapping from `SearchResult` to `CompanyDetailArticle` is a pure in-memory
  transform; nothing is inserted into the article store.
- Tag the synthetic rows (for example a `source` label or a boolean flag) so the
  UI can mark them as web-sourced rather than in-corpus coverage.

Secondary option: do the same inside `getCompanyDetail()` after the
`articlesRes` map (getCompanyDetail.ts:174), guarded by the same threshold, so
every caller of `getCompanyDetail` benefits. The page-level slot is preferred for
the first cut because it keeps the network-dependent Exa call out of the core
data-access function and isolated to the route that renders the tab.

Threshold note: use article count below a small constant (3 here) rather than
exactly 0, so companies with one or two stale co-mentions still get a populated
tab. Pair it with the existing 14-day window: today SNOW has 0 in-window rows, so
any threshold from 1 upward triggers the backfill.

## Done-when checklist

- (a) ArticlesTab fetch file and function: `getCompanyDetail()` in
  `src/lib/data-access/getCompanyDetail.ts` (the `articlesRes` query, lines 97-104),
  wired to the tab at `src/app/company/[id]/page.tsx:90`. Stated.
- (b) SNOW index status and article count shown with evidence: indexed
  (companies row, ticker SNOW); 3 tagged ever, 0 in 14d, newest 2026-04-30;
  94 untagged text mentions in 30d. Shown.
- (c) Root cause stated in one paragraph. Done (section 3).
- (d) This file exists on branch `recon/snow-websearch`; git status shows only
  this file changed.
