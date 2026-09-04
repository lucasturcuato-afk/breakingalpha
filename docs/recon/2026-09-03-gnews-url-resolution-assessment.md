# Google News URL resolution: assessment

Recon date 2026-09-03. Investigation only; nothing here is built. Every number
was measured on that date against prod rows or live endpoints, with the method
stated inline. Total requests made to Google during this investigation: 12
(spaced), plus one 594KB shell fetch on 2026-09-02.

## The problem being assessed

17,103 of the last 20,166 stored rows (84.8%) are Google News per-ticker
arrivals whose `url` is a `news.google.com/rss/articles/CBMi...` redirect. We
cannot reach the real article, so those rows are headline-only (0.3% prose) and
contribute nothing to the fact layer. `publisher` / `publisher_domain` are
populated on 100% of the last 7 days' gnews rows (measured 5,450/5,450, all
clean hostnames), so we know WHO published every story; we lack the URL.

One scoping note up front: **rows ingested before June 2026 carry no
`rss/articles` URLs at all** (the gnews per-ticker path began ~June). Every
finding below concerns the June-onward corpus.

---

## B1 — Is the blob decodable? No. 240/240 opaque.

Method: sampled 60 gnews URLs per month for June, July, August, September
(240 total), base64url-decoded each `CBMi...` blob, and walked the protobuf
wire format directly (varint tags, length-delimited fields, one nesting level).

| month | sampled | URL embedded | opaque | decode failures |
| --- | ---: | ---: | ---: | ---: |
| 2026-06 | 60 | 0 | 60 | 0 |
| 2026-07 | 60 | 0 | 60 | 0 |
| 2026-08 | 60 | 0 | 60 | 0 |
| 2026-09 | 60 | 0 | 60 | 0 |

Every blob decodes cleanly as protobuf and every one has the same shape:

    field 1 (varint) = 19
    field 4 (bytes)  = "AU_yqL..." — a 143-byte opaque token

That `AU_yqL` token is the post-2024 format: an encrypted article ID with no
recoverable URL inside. The historical direct-URL format (where field 2 held
the article URL in cleartext) does not appear in this corpus at all — our
ingest postdates Google's format change. **Fraction decodable to a URL: 0%,
stable across all four months we have.**

## B2 — The batchexecute path: it works, measured 5/5

This corrects the 2026-09-02 assessment. That probe grepped the 594KB shell
page for external hostnames, found none, and concluded server-side resolution
was impossible. The signature attributes were missed. They are there:

- `data-n-a-ts` — a timestamp (e.g. `1788473925`)
- `data-n-a-sg` — a signature string
- `data-n-a-id` — the article blob itself

Both required values sit in the static HTML of the shell page, so **no
JavaScript execution and no headless browser is needed.** The full recipe,
verified end to end:

1. `GET` the `news.google.com/rss/articles/...` URL with a browser UA.
   Returns ~580-600KB of HTML. Extract `data-n-a-ts` and `data-n-a-sg`.
2. `POST https://news.google.com/_/DotsSplashUi/data/batchexecute` with
   form field `f.req = [[["Fbv4je", <inner>, null, "generic"]]]` where
   `<inner>` is a JSON-encoded `["garturlreq", [<locale config>], <blob>,
   <ts>, <sg>]`.
3. The response (after the `)]}'` prefix) contains a `garturlres` payload
   with the real article URL — both an AMP variant and the canonical URL.

No cookies, no login, no API key. Requirements are exactly: the two
per-article values from step 1, a plausible UA, and the undocumented `Fbv4je`
RPC id.

Measured on 5 articles across 5 distinct publishers (simplywall.st, Yahoo
Finance, Seeking Alpha, Yahoo Finance Singapore, Pluang), requests spaced 2s:

| result | count |
| --- | ---: |
| resolved to a real URL | **5/5** |
| resolved URL's host == stored `publisher_domain` | **5/5** |

### What ~1,200/day would mean

- **Two requests per article**, and the first is a ~580KB page: at the current
  ~1,316 gnews rows/day that is ~2,600 requests and **~750MB/day of transfer
  from Google**, forever.
- **Rate limiting: deliberately untested.** 12 spaced requests tell you the
  mechanism works, not what happens at 2,600/day from one IP. Community
  experience with this endpoint (it is what every open-source gnews resolver
  wraps) is periodic 429s and consent-page interstitials at volume.
- **Format risk is proven, not hypothetical**: the 2024 change from
  URL-in-protobuf to `AU_yqL` tokens broke every existing resolver at once.
  `Fbv4je`/`garturlreq` is a private RPC that Google can and does change
  without notice.
- The whole approach also amounts to working around Google's deliberate
  opaquing of these URLs; treat that as a standing product/ToS judgment call,
  not a purely technical one.

### Failure profile — the question that matters most

The good news: this fails **detectably**. Every failure mode lands in one of
two observable buckets — an HTTP error, or a 200 whose body no longer parses
to a `garturlres` URL. A resolver instrumented with a per-run
`resolved / attempted` counter (the `rss_feed_stats` pattern, sql/0036) turns
every one of those into a visible rate drop. The *silent* variant — plausible
but wrong URLs — is closable too: `publisher_domain` is populated on ~100% of
current rows, so every resolution can be domain-checked against what the RSS
`<source>` element said, and a mismatch is a hard reject. 5/5 passed that
check in the probe.

## B3 — Google-free alternatives: measured, and effectively hopeless

Precondition first, as asked: can we even reach publisher infrastructure?
Yes — `publisher_domain` is non-null and a clean hostname on **100%** of the
last 7 days' 5,450 gnews rows. The input side is not the problem.

Method: for the 6 highest-volume gnews publisher domains (119 to 43 rows each
over two days), probe six standard news-sitemap URL shapes, then match stored
gnews titles against sitemap URL slugs (≥4 shared tokens of length ≥4).

| domain | news sitemap | hit rate |
| --- | --- | ---: |
| finance.yahoo.com | `/news-sitemap.xml` (918 urls) | 1/10 |
| marketbeat.com | none found (6 shapes) | 0/10 |
| stocktitan.net | none found | 0/10 |
| simplywall.st | none found | 0/10 |
| seekingalpha.com | `/sitemap_news.xml` (639 urls) | **7/10** |
| ad-hoc-news.de | none found | 0/10 |
| **overall** | | **8/60 = 13%** |

Two structural problems: four of the six domains expose no discoverable news
sitemap at all, and where one exists it is a rolling recent-articles window,
so anything older than ~48h is unreachable. Per-publisher site search was not
pursued further: it would mean a bespoke, individually-breaking integration
per domain for a tail of 397 publishers. 13% coverage with per-domain
maintenance is strictly worse than both alternatives (resolve via Google, or
don't resolve).

The one place this is worth remembering: seekingalpha.com resolves at 7/10
via its own sitemap. If a future need is narrowly "resolve Seeking Alpha
links", that path avoids Google entirely.

## B4 — Recommendation

**Do not build a general resolver now.** Three reasons, in order:

1. **The cheap lever is already pulled and is not exhausted.** The feed
   expansion rounds (#827, #829) take the extractable population from
   ~200/day to ~500+/day without touching Google. The fact layer does not yet
   consume any of it. Building a scraping dependency on a private Google RPC
   before the clean substrate is even being used is effort in the wrong order.

2. **The bulk of what resolution would unlock is low-value.** The gnews tail
   is dominated by MarketBeat 13F boilerplate, simplywall.st templates and
   Stock Titan (63/day whose own feed carries 0% prose). Resolving ALL gnews
   rows buys ~750MB/day of transfer and a maintenance tail mostly to reach
   content the relevance gate scores 1-2.

3. **The maintenance profile is real**: proven format churn (2024), an
   undocumented RPC, and untested behavior at 2,600 requests/day.

**If/when it is built, scope it like this** (the shape that survives the
failure-mode question):

- **Selective, not general.** Resolve only gnews rows with
  `relevance_score >= 8`: measured **~148/day (11.3% of gnews)** — that is
  ~300 requests/day instead of 2,600, an order of magnitude less exposure.
- **Domain-checked.** Reject any resolution whose host does not match the
  row's `publisher_domain`. This is the guard that makes wrong-URL failures
  impossible to store silently.
- **Counted.** `resolved / attempted / domain_mismatch` per run, persisted
  alongside `rss_feed_stats` (sql/0036 pattern). A resolver whose resolved
  rate is not on a dashboard is exactly the "silently returns nothing"
  artifact to avoid; with the counter, degradation is a visible number within
  one run.
- **Fail-open.** Resolution failure leaves the row exactly as it is today
  (headline-only, google URL). The pipeline must never block or degrade on
  Google's whims.
- **Isolated.** A separate post-store pass (like the fact-extractor design),
  never inline in ingest, so a Google change can only ever cost the
  enrichment, not the run.

Decision stays with you; nothing was built.

## Appendix — method notes

| claim | method |
| --- | --- |
| 240/240 opaque | monthly sampled `rss/articles` URLs, base64url + hand-rolled protobuf wire walk, string scan incl. one nesting level |
| batchexecute recipe | live: 1 shell GET + 1 POST for the first article; then 4 more articles across 4 publishers, 2s spacing |
| domain check 5/5 | resolved host compared to the stored `publisher_domain` per row |
| sitemap 13% | 6 domains x 6 URL shapes, 3MB read cap, slug-token matching vs 10 stored titles per domain |
| `publisher_domain` 100% | full 7-day keyset read, 5,450 gnews rows, regex shape check on every domain |
| rel>=8 sizing | 2026-08-20..09-02 window (17,103 gnews rows), threshold counts |
