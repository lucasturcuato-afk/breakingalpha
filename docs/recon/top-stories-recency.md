# Top Stories Recency: Phase 1 Recon

Branch: `fix/top-stories-recency`
Date: 2026-06-08
Scope: dashboard "Top Stories" module surfacing articles that are hundreds of days old.

All file paths below are repo-relative. Line numbers reflect `origin/main` at `2de98103`.

---

## 1. Where "Top Stories" is rendered

Rendered on the dashboard route in `src/app/dashboard/page.tsx`.

The heading and list live at lines 647 to 729:

```tsx
{/* Stories section */}
<div className="mt-4">
  <div className="flex items-center justify-between mb-2">
    <div className="flex items-center gap-3">
      <h2 className="font-sans text-[10px] font-medium uppercase tracking-wider text-text-muted inline-flex items-center gap-1.5">
        Top Stories — hover to expand
        <InfoTooltip content="The highest-signal articles today, ranked by Signalera's relevance algorithm." side="bottom" iconSize={10} />
      </h2>
```

The list renders a `LeadStoryCard` for `displayStories[0]` (line 713) and `CompactStoryCard` for the rest (line 725). `displayStories` is defined at line 407:

```tsx
const displayStories = storyTab === "for-you" ? forYouStories : stories;
```

`forYouStories` (line 402) is just `stories` re-sorted client-side by personalization via `sortByRelevance(...)`; it does not change which rows were fetched. So the underlying data set for both tabs is the `stories` state.

Note the tooltip copy already promises "highest-signal articles today" (line 653), which the current query does not actually honor.

## 2. What populates it

`stories` is populated by `loadStories()`, an in-component `useEffect` in `src/app/dashboard/page.tsx` at lines 164 to 293. The "Top Stories" fetch is the "Get top 4 stories" block at lines 224 to 230. There is no API route or shared lib function in this path; the page queries Supabase directly from the client.

## 3. The actual query (select, filters, ordering, limit)

`src/app/dashboard/page.tsx` lines 224 to 230, verbatim:

```tsx
// Get top 4 stories
const { data, error } = await supabase
  .from("articles")
  .select("id, title, source, summary, content, sector, industry_verticals, activity_types, sentiment, published_at, ingested_at, url, companies, relevance_score")
  .order("relevance_score", { ascending: false })
  .order("ingested_at", { ascending: false })
  .limit(4);
```

- select: the column list above.
- filters: NONE. There is no `.gte(...)`, no `.lte(...)`, no window of any kind.
- ordering: `relevance_score` desc, then `ingested_at` desc as a tiebreaker.
- limit: 4.

## 4. How ordering is done today (the prime suspect)

Ordering is purely by `relevance_score` desc with `ingested_at` desc as a tiebreaker (lines 228 to 229). There is NO recency window. Because `relevance_score` is the primary key and there is no date filter, any article with a high `relevance_score` outranks newer articles with lower scores no matter how old it is. The `ingested_at` tiebreaker only matters between rows of equal `relevance_score`, so it does nothing to bound age across different scores.

This is the prime suspect and the confirmed root cause (see statement at the end).

## 5. How and when relevance_score is computed

`relevance_score` is computed ONCE at ingest by Gemini and never decayed or recomputed.

- Model field: `backend/ingest.py` lines 101 to 113 (`FilterDecision`, `relevance_score: int = Field(ge=1, le=10)`).
- Scoring rubric prompt: `backend/ingest.py` lines 385 to 443 (a fixed 1 to 10 rubric: 10 = direct material company event, 6 to 7 = analyst action, 1 to 5 = low-template or no first-order event).
- Written to the row: `backend/ingest.py` line 1154 inside `_article_row`: `"relevance_score": analysis["relevance_score"],`, inserted via `store_article` at lines 1492 to 1494.
- Storage gate: `backend/ingest.py` line 1560 only stores rows scoring `>= 6`.

Key consequence: `relevance_score` is a static, time-invariant signal. It captures "how important is this article" but carries no notion of "how recent." Sorting by it alone, with no date window, is therefore guaranteed to surface stale high-score rows over fresh lower-score rows. It lives on the `articles` table as an integer 1 to 10.

There is no `mention_count` column on `articles`. Mention tracking lives in the `company_mentions` table and per-company counts on `companies` (`backend/ingest.py` lines 1502 to 1510); it does not feed Top Stories ranking.

## 6. Reliable date columns on `articles`

Two timestamp columns, both `timestamptz` (UTC):

- `published_at`: nullable in schema, but in practice populated at ingest. When the RSS feed lacks a publish date, ingest falls back to `now()` (`backend/ingest.py` line 249 `e.get("published", now_iso)`, line 667, line 718, line 764). So in stored rows it is effectively always present.
- `ingested_at`: `DEFAULT now()`, server-assigned at INSERT. Always present, always fresh at insert time.

Data-quality notes:
- Ingest skips RSS articles older than `INGEST_FRESHNESS_DAYS = 7` at ingest time (`backend/ingest.py` line 691, skip logic lines 699 to 742). So freshly ingested rows should have a `published_at` within ~7 days of their `ingested_at`.
- The known failure mode: RSS feeds sometimes republish OLD content with a fresh `ingested_at` while keeping a stale `published_at`. These rows pass the ingest freshness check (ingested recently) but carry a `published_at` that can be 100+ days old. Documented verbatim at `backend/synthesize.py` lines 1070 to 1074.
- No explicit future-date guard exists at ingest. Future-dated `published_at` is theoretically possible from a bad feed, though not observed.
- Frontend defensive coalescing already assumes `published_at` can be missing: the dashboard renders `timeAgo(a.published_at || a.ingested_at)` at line 268.

The displayed "X days ago" on each card comes from `published_at` (falling back to `ingested_at`). That is why republished or long-ingested high-score rows read as "hundreds of days old" in the UI.

## 7. Other consumers and the existing precedent

The dashboard query is NOT shared. Each page inlines its own Supabase fetch. That bounds the blast radius of a dashboard-only change to the dashboard.

Same unfiltered pattern (identical bug, separate route):
- `src/app/preview/page.tsx` lines 67 to 72: byte-for-byte the same `relevance_score` desc, `ingested_at` desc, `.limit(4)` query with no window. This is a separate route from the mission target but carries the identical defect. Flagged as a follow-up, not fixed here (see plan, "What I am NOT doing").

Existing recency precedent already in the codebase (the convention to match):

a) Frontend, `src/app/evening-wrap/page.tsx` lines 287 to 308 and `src/app/morning-brief/page.tsx` lines 337 to 357. Both define `cutoff24h` and `cutoff48h`, run a primary query with `.gte("ingested_at", cutoff24h).order("relevance_score", desc)`, and when fewer than 3 rows come back, fall back to a 48h window and relabel the section ("Today's Top Stories" becomes "Recent Stories"). Verbatim evening-wrap:

```tsx
const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
const cutoff48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

let { data: articles } = await getSupabase()
  .from("articles")
  .select("...relevance_score")
  .gte("ingested_at", cutoff24h)
  .order("relevance_score", { ascending: false })
  .limit(8);

let label = "Today's Top Stories";
if ((articles?.length ?? 0) < 3) {
  const { data: fallback } = await getSupabase()
    .from("articles")
    .select("...relevance_score")
    .gte("ingested_at", cutoff48h)
    .order("relevance_score", { ascending: false })
    .limit(8);
  articles = fallback;
  label = "Recent Stories";
}
```

b) Backend, `backend/synthesize.py` lines 1069 to 1098, the strongest anti-stale precedent. It filters on BOTH columns: `ingested_at >= 24h` AND `published_at >= 48h`, orders by `relevance_score` desc, and on an empty result widens `published_at` to 7 days but "never goes fully unbounded." Its comment (lines 1070 to 1074) is the exact rationale for guarding `published_at`, not just `ingested_at`:

```python
# Use a 48-hour window for published_at to allow late-breaking
# articles that were genuinely published within ~2 days. RSS feeds
# sometimes republish older content with new ingest timestamps —
# filtering on both published_at AND ingested_at prevents stale items
# (sometimes 100+ days old) from being chosen as "Top Stories".
```

So the codebase already has a composite "relevance ordering inside a recency window, with a widen-on-thin-results fallback" convention. The dashboard simply does not use it.

---

## Root-cause statement

Top Stories is stale because the dashboard query in `src/app/dashboard/page.tsx` (lines 224 to 230) orders articles purely by `relevance_score` desc with `ingested_at` desc as a tiebreaker and applies NO recency window at all. `relevance_score` is computed once at ingest and never decayed, so it is a pure importance signal with no time component; with no date filter, a high-score article from months ago (whether ingested long ago, or republished by an RSS feed with a stale `published_at` but fresh `ingested_at`) outranks today's lower-score articles and surfaces as a "Top Story" that reads as hundreds of days old. Sibling surfaces (evening-wrap, morning-brief, and the backend synthesizer) already avoid this by ordering relevance INSIDE a recency window with a widen-on-thin-results fallback; the dashboard is the one place that skipped that guard.
