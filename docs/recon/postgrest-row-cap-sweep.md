# PostgREST row-cap sweep, src/ and backend/

2026-09-02. Swept after the cap produced a fourth wrong number, this time in the
step 12 repair tool where a truncated merge map would have left ~3,400 articles
unrepaired with nothing recording the miss.

**The hazard.** PostgREST caps every response at `db-max-rows`, which is **1000**
here, and does not error when it truncates. `.limit(5000)` returns 1000 and looks
complete. `count="exact"` returns the true total *while the body is still
truncated*, which is what makes the check cheap and the bug invisible.

Prioritised by blast radius: what the result feeds, not how ugly the code is.

---

## P1 — live, and reaches a user

### `src/app/api/export/watchlist-xlsx/route.ts:53`

```ts
.limit(2000);   // watchlist_articles, filtered to the user's identifiers + 30d
```

**22 of 43 watchlist owners are truncated today.** Largest per-user 30-day set is
**5,190 rows** across 26 entries; five more sit above 3,000.

Two separate defects, and fixing only the visible one leaves the export wrong:

1. `.limit(2000)` is above the cap, so the route gets **1000**, not 2000.
2. Even 2000 was already too low for the top user at 5,190.

So this needs pagination, not a bigger number. A user exports their watchlist,
gets a file that looks complete, and silently loses up to 80% of their articles.
No error, no marker in the sheet.

---

## P1 — live, and feeds ingest correctness

### `backend/ingest.py:3174` — title dedup preload

```python
recent = supabase.table("articles").select("title").gte("ingested_at", cutoff).execute().data
```

24-hour window holds **1,602 rows**; the read sees **1,000**. So **38% of the
window is invisible to title dedup** and a duplicate-titled article inside that
blind spot is stored rather than skipped. This is a data-quality bug, not just a
cost one.

### `backend/ingest.py:1789` — URL dedup preload

```python
ex_resp = supabase.table("articles").select("url").gte("ingested_at", cutoff).execute()
```

30-day window holds **50,386 rows**; the read sees **1,000**, which is **2% of
the dedup set**. The block's own comment says it exists to "dedupe candidates
BEFORE handing them to the Gemini filter (saves tokens and gives an accurate
duplicate count in the structured log line)". Both stated purposes fail: 98% of
known URLs are missing so duplicates are filtered and graded at full token cost,
and the duplicate count in the log is wrong.

Mitigating, and worth stating so this is not over-read: the store path still does
a point lookup (`select("id").eq("url", ...)`), so duplicates are not actually
**stored** by this path. The cost is wasted Gemini spend and a false log figure.

---

## P1 — live, and feeds a decision

### `backend/lead_weight_calibrator.py:662`

```python
.select("id,created_at,brief_type,preselect_decision").order(...).limit(2000)
```

`pipeline_runs` holds **1,572** rows; the calibrator sees **1,000**. It is
ordered `created_at DESC`, so it loses the *oldest* 572 runs. The weights it
derives are fit to a truncated history, and `diag["runs_scanned"]` reports 1000
as though that were the corpus.

### `backend/user_signal_aggregator.py:56`

```python
.select("user_id, event_type, payload, created_at").gte("created_at", cutoff).limit(5000)
```

`user_events` in the last 30 days is **1,410**; the read sees **1,000**. Ordered
`created_at DESC`, so the oldest 410 events in the window are dropped from every
inferred sector weight. Personalization is fit to 71% of the signal.

---

## P2 — latent, no code change needed to break

### `backend/ingest.py:390` and `:431`

```python
supabase.table("companies").select("ticker, name").not_.is_("ticker", "null").execute()
```

**961 rows. Thirty-nine of headroom.** Under the cap today and crosses on its own
as companies are added, with no deploy and no signal. Both feed the gnews ticker
universe, so crossing it quietly shrinks what the pipeline fetches.

This is the entry most likely to be dismissed in review and the one that will
break unattended.

### Over-cap limits whose tables are currently small

| site | table | rows today |
|---|---|---|
| `lead_weight_calibrator.py:706` | `lead_outcome_grades` | 13 |
| `pattern_memory.py:182` | `theses` (outcome not null) | 41 |
| `source_credibility.py:121` | `theses` (outcome not null) | 41 |
| `source_reliability.py:394` | `morning_brief_call_outcomes` (clean) | 85 |

`.limit(5000)` on each. Harmless now, wrong in principle, and each becomes a P1
the moment its table grows. Worth fixing with the same helper rather than
tracked as four separate future bugs.

---

## Checked and NOT a problem

- `src/app/trends/page.tsx:514` uses `count: "planned", head: true` — a count
  with no rows returned. Correct, and already carries a comment explaining the
  estimate's limits.
- `src/app/dashboard/page.tsx:334` reads `pipeline_runs` over `SPARK_DAYS = 12`,
  which is **202 rows**. Under the cap with real headroom.
- The bulk of raw grep hits are `.insert`/`.upsert` chains, or point lookups with
  `.eq(`/`.in_(`. A sweep that does not filter those is ~95% false positives.

---

## The fix shape

Already implemented in `tools/repair_articles_companies.py` and worth lifting to
a shared helper:

```python
head = client.table(t).select(cols, count="exact").limit(1).execute()
expected = head.count
rows, page = [], 0
while len(rows) < expected:
    r = client.table(t).select(cols).order(order_col).range(page*1000, page*1000+999).execute()
    if not r.data: break
    rows += r.data; page += 1
if len(rows) != expected:
    raise RuntimeError(f"TRUNCATED READ: {t} reports {expected}, fetched {len(rows)}")
```

The assertion is the part that matters. Pagination alone still fails silently if
the loop terminates early; comparing against a server-side count is what turns a
short read into an error.

**Exception: keyset.** Where `count(*)` itself times out (`articles`, 57014),
paginate on `.gt("id", last)` instead. A capped page is indistinguishable from a
full one and the walk simply continues, so truncation cannot silently end it.

## Suggested order

1. `watchlist-xlsx` — user-facing, live, half the userbase
2. `ingest.py:3174` — duplicate articles being stored
3. `lead_weight_calibrator.py:662` and `user_signal_aggregator.py:56` — decisions
   fit to truncated data
4. `ingest.py:1789` — wasted spend, wrong log figure
5. `ingest.py:390`/`:431` — 39 rows from breaking
6. The four small-table `.limit(5000)` sites, with the shared helper
