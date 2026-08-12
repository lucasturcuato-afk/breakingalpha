# Dashboard: 46 API requests per load, mostly duplicates

**Status:** observation only. Deliberately NOT fixed in the reveal-gate PR. Next PR.
**Measured:** 2026-08-12, `/dashboard`, one full reload, Chrome, dev server, signed in.
**Method:** `performance.getEntriesByType('resource')` filtered to `/api/`, grouped by pathname.

## Headline

**46 API requests for one dashboard load.** Two endpoints account for 44 of them.

| endpoint | n | p50 ms | min ms | max ms |
|---|---|---|---|---|
| `/api/watchlist-quotes` | **30** | 361 | 3 | 1,963 |
| `/api/stock-chart` | **14** | 665 | 4 | 1,075 |
| `/api/related-articles` | 8 | 9 | 4 | 19 |
| `/api/market-indices` | 10 | 268 | 2 | 2,970 |
| `/api/system-intelligence` | 2 | 8,669 | 2,604 | 8,669 |
| `/api/radar/following-feed` | 2 | 7,915 | 2,598 | 7,915 |
| `/api/radar/claims` | 2 | 4,979 | 2,430 | 4,979 |
| `/api/watchlist-feed` | 2 | 3,042 | 1,430 | 3,042 |
| `/api/user-profile` | 2 | 3,028 | 1,879 | 3,028 |
| `/api/watchlist-notifications` | 2 | 2,848 | 1,899 | 2,848 |
| `/api/watchlist/pinned` | 2 | 2,240 | 1,018 | 2,240 |
| `/api/watchlist` | 2 | 1,700 | 1,620 | 1,700 |

`page_load_ms: 1518` · `dom_content_loaded_ms: 1266`

## Where the duplication comes from

`RotatingLeadHero` refetches on every rotation. Its children (`HeroThread`, `HeroPeers`, `SparkLine`) each call `/api/watchlist-quotes` and `/api/stock-chart` per rotation tick, for the same tickers, with no cache between ticks. The observed request stream is dominated by the same two URLs repeating:

```
/api/watchlist-quotes?symbols=YPF     ← repeated ~15x
/api/stock-chart?ticker=YPF&range=1mo ← repeated ~9x
```

## Also seen

- **`/api/watchlist-quotes` returned `503` twice** during the same load, while other calls to the same endpoint returned 200. Intermittent, not a hard outage. Worth understanding before adding caching on top of it.
- Every source is a client-side `useEffect` fetch; there is no server-side data on this page.

## Caveats before acting

- **These are dev-server numbers.** Every endpoint shows n=2 with a wide min→max spread because the first hit of each route includes Turbopack compilation. The `min` column is the better proxy for warm behaviour. **Production has not been measured.** Do not size a cache TTL or a timeout off the `max` column.
- The n=2 pattern on the once-per-load endpoints suggests React 18 StrictMode double-invocation in dev. That likely halves in production, which would put the real count nearer ~23 than 46 — but the *ratio* of duplication on `watchlist-quotes` and `stock-chart` is a rotation artefact, not a StrictMode one, and would remain.

## What would establish whether it is worth fixing

1. Re-measure in production (or a production build locally) to separate StrictMode doubling and compile time from real duplication.
2. Count distinct URLs vs total requests over a 60s dwell on the page, to capture the rotation steady-state rather than just the initial load.
3. Check whether `/api/watchlist-quotes` and `/api/stock-chart` set any cache headers today, and whether the 503 rate correlates with request volume.

## Related

The reveal gate added in the layout/loading PR gates on each source's **first** settle precisely so this refetch storm cannot re-trigger the page loading state. That is a containment, not a fix — the requests still happen.
