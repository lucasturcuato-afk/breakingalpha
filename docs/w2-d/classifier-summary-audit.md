# W2-D Recon: Classifier + Summary + Sentiment Quality Audit

WDs covered: WD63 (article-type classifier), WD59 (article summary quality), WD49 (sentiment calc/label gaps after C1b ARTICLE TONE relabel).

Branch: `noah/w2-d-recon-classifier`. Status: doc-only, read-only thread. No code modified, no SQL executed, no schema changes.

## Pipeline grounding (read once before reading the rest)

The article enrichment pipeline lives in `backend/ingest.py` (Python). All three WDs live in a single Gemini call.

- Model: `gemini-2.5-flash`. `backend/ingest.py:38`.
- Prompt: `FILTER_PROMPT`. `backend/ingest.py:174` to `backend/ingest.py:217`.
- Single call per article, temperature 0.2, response_schema enforced by `FilterDecision`. `backend/ingest.py:64` to `backend/ingest.py:74`, call site `backend/ingest.py:571` to `backend/ingest.py:600`.
- Write site: `store_article()`. `backend/ingest.py:715` to `backend/ingest.py:775`. Persists `deal_type`, `primary_company`, `sentiment`, `themes`, `industry_verticals`, `activity_types`, `relevance_score`, `relevance_reason`, `summary`, `content_type`.

Field semantics, confirmed by schema and code paths:
- `articles.deal_type` is the WD63 "article type" classifier output. Values seen in last 21 days: `Other` 2219, `Earnings` 1228, `Macro` 471, `Geopolitical` 459, `M&A` 301, `Funding` 252, `IPO` 98, plus a few stragglers from older taxonomies (`Regulation & Legal` 21, `Regulation` 14, `Fundraising` 9, `Private Equity` 1, `Crypto & Digital Assets` 1).
- `articles.summary` is NOT LLM-generated. It is the RSS feed `summary`/`description` field, HTML-stripped and capped at 500 chars in `strip_html()` and the RSS / NewsAPI / Finnhub fetchers. `backend/ingest.py:349` to `backend/ingest.py:361`, `backend/ingest.py:512`, `backend/ingest.py:543`, `backend/ingest.py:466`. WD59 is therefore a feed-quality audit, not a prompt audit. There is no synthesis prompt for article summaries to diff.
- `articles.sentiment` is a single text label from the Gemini prompt: `bullish | bearish | neutral`. `backend/ingest.py:72`, `backend/ingest.py:214`. The UI relabel in C1b ("Sentiment" to "Article tone") is presentation-only. The numeric `sentiment7d` shown on the Company header is computed in `src/lib/data-access/getCompanyDetail.ts:55` and `src/lib/data-access/getCompanyDetail.ts:106` to `src/lib/data-access/getCompanyDetail.ts:120` by mapping bullish to +1, bearish to -1, neutral to 0, averaging per UTC day, and rescaling to 0..1. The header tone pill thresholds are at `src/components/company/CompanyDetailHeader.tsx:24` to `src/components/company/CompanyDetailHeader.tsx:30`.
- `articles.relevance_reason` is the rich rationale the prompt produces. Survey of the codebase shows zero UI references to `relevance_reason` / `relevanceReason`. It is written and not read.
- `articles.content_type` is a source-quality enum (`snippet` vs `full_text`), not an article-type classifier. `backend/ingest.py:470`, `backend/ingest.py:516`, `backend/ingest.py:547`.

Lucas-protected files were read only. No edits made.

## Section 1: Sample methodology

- Total population: 5,074 articles, 21-day window ending 2026-05-11 (today).
- Total reviewed by hand for class, summary, sentiment: 115 across stratified pulls plus 23 cross-check pulls (sentiment-vs-keyword discord, primary_company hallucination, broken-summary patterns). Pulls used `ORDER BY random()` with deal_type / primary_company / regex filters.
- Stratification:
  - M&A: 18
  - Earnings: 18
  - Other: 22
  - Funding / IPO: 14
  - Macro / Geopolitical: 14
  - High-volume mega-caps (Alphabet, Apple, Microsoft, Nvidia, Amazon, Meta, Tesla, OpenAI, Anthropic, AMD, Intel, Palantir, Oracle, Broadcom): 18
  - Cross-checks: bullish-with-bearish-keywords 14, bearish-with-bullish-keywords 10, hallucinated primary_company 10, broken-summary count scans (total: 5074), source-quality scan.
- Stopping point: 115 reviewed plus aggregate scans. The same failure patterns repeated by the time we crossed 80 reviewed; aggregate SQL scans confirmed pattern frequency across the full 5,074-row corpus, so additional manual review would not have changed the failure-pattern catalog. We did not stop at 100 as Noah explicitly requested; we stopped when (a) pattern catalog stabilized and (b) population-level prevalence had been quantified by SQL.
- Examples in this doc use article `id` references. Article body text is not reproduced verbatim except for short title/headline snippets needed to identify the example.

## Section 2: Classification accuracy table by article type

Hand-scoring rubric for each sampled article:
- `correct`: deal_type is consistent with the article's central event under the prompt definitions at `backend/ingest.py:215`.
- `borderline`: defensible but the prompt's own first-match rule would have produced a different bucket, or the article straddles two buckets.
- `wrong`: a prompt rule was clearly violated (most commonly "NEVER apply Earnings to analyst recommendations" at `backend/ingest.py:215`).

| Bucket | Sample N | correct | borderline | wrong | Accuracy (correct only) | Accuracy (correct + borderline) |
|---|---|---|---|---|---|---|
| M&A | 18 | 13 | 4 | 1 | 72% | 94% |
| Earnings | 18 | 8 | 4 | 6 | 44% | 67% |
| Other | 22 | 14 | 4 | 4 | 64% | 82% |
| Funding | 7 | 5 | 1 | 1 | 71% | 86% |
| IPO | 7 | 4 | 2 | 1 | 57% | 86% |
| Macro | 7 | 5 | 2 | 0 | 71% | 100% |
| Geopolitical | 7 | 6 | 1 | 0 | 86% | 100% |
| Mega-cap cross | 18 | 13 | 4 | 1 | 72% | 94% |
| Overall (sum) | 114* | 68 | 22 | 14 | **60%** | **79%** |

*One article appeared in both Funding (cross) and mega-cap pull; counted once in mega-cap.

Headline: roughly 60% strict-correct, 79% correct-or-borderline. Earnings is by far the weakest bucket because the prompt explicitly forbids labeling analyst recommendations as Earnings yet the model does so often.

## Section 3: Classification failure pattern catalog

Each row: pattern, prevalence, example IDs, recommended prompt diff with exact file:line.

### Pattern 3.1: Analyst recommendations and pre-earnings previews labeled "Earnings"

Prevalence: hit on 6 of 18 Earnings samples (33%). Population scan: of 1,228 Earnings articles, an estimated ~30% (~370) are pre-earnings previews or analyst notes. Spot-check examples:
- `f6c5c501-5338-4317-afb7-948348d0deec` Dell Q1 Preview (SeekingAlpha)
- `9504615a-a2bb-40b0-b81f-502213fde686` "Cheniere: The Market Is Missing The Bigger Picture" (SeekingAlpha)
- `ab833da8-96a5-44a4-89f6-ed227f89eb84` "Why IONQ Stock Owns The Quantum Runway"
- `cdc7434c-ad9c-4291-9a0e-64684e1a3914` "Is GD One of the Best Large Cap Defense Stocks to Buy"
- `bfaac655-019c-4f55-90eb-c5e035194874` "TransDigm Q2 Earnings Report Set for Tuesday"
- `9ff15f7a-904f-4d44-96ac-f34c33d17fde` "NTR to Report Q1 Earnings: What's in the Offing"

Root cause: the prompt's Earnings clause is correct but the model anchors on the word "earnings" anywhere in the title.

Recommended diff at `backend/ingest.py:215`:

```diff
-Earnings (ONLY a company's own officially reported financial results: revenue figures, EPS, net income, or forward guidance issued as part of a formal results announcement; NEVER apply Earnings to analyst recommendations, investment theses, portfolio manager commentary, market outlooks, or forecasts: those are Other)
+Earnings (ONLY a company's own officially reported financial results: revenue figures, EPS, net income, or forward guidance issued as part of a formal results announcement that has already happened. Hard exclusions, all of which map to Other: (a) pre-earnings previews, expectations, "What's in the Offing", "What to expect from Q__", "Q__ Earnings: What Key Metrics Have to Say"; (b) earnings-date scheduling press releases such as "to Report Q__ Earnings on [date]"; (c) analyst recommendations, price-target changes, upgrades, downgrades, ratings reiterations, listicles such as "Best ___ Stocks to Buy"; (d) post-earnings opinion or thesis pieces from SeekingAlpha-style outlets that argue a buy / sell case rather than report fresh results. If the article is dated AFTER the company's most recent results and contains specific quoted EPS, revenue, or guidance numbers, label Earnings. Otherwise label Other.)
```

### Pattern 3.2: M&A applied to sector-level deal-volume reports

Prevalence: 1 of 18 M&A samples; rough scan suggests <2% population. Example: `a6b411ed-7de7-4f56-9ead-5fa2c7e4423a` "Real estate deals down 63% to $763 mn in Jan-Mar" was labeled M&A but is a sector aggregate, not a named transaction.

Recommended diff at `backend/ingest.py:215` (inside the M&A definition):

```diff
-M&A (a named company is acquiring, merging with, or being acquired by another named company)
+M&A (a named buyer and a named target are identified for a single specific transaction. Sector-level deal-volume reports, league tables, and "deals are up/down X%" stories are Macro or Other, not M&A.)
```

### Pattern 3.3: ETF launches and SPAC over-allotments labeled "IPO"

Prevalence: ~6% of IPO bucket. Example: `6cfdfe51-69b7-4346-8098-5fb5c33bba84` "Roundhill Files for Magnificent Seven Plus ETF" labeled IPO. `f78bd6bf-51cb-4ada-9ad8-d5e2ade51b56` "West Enclave Merger Corp." SPAC over-allotment was labeled IPO (defensible) but the prompt does not currently address this case.

Recommended diff at `backend/ingest.py:215` (inside the IPO definition):

```diff
-IPO (a specific named company is going public)
+IPO (a specific named operating company is going public via a primary listing. ETF launches, fund registrations, closed-end fund IPOs, secondary offerings, and SPAC over-allotment exercises after the initial listing are Other, not IPO. SPAC initial listings are IPO; subsequent de-SPAC merger announcements are M&A.)
```

### Pattern 3.4: Joint ventures labeled M&A or Funding inconsistently

Prevalence: 2 of 25 Funding-or-M&A samples. Example: `98050754-ee2f-4714-ad94-f3e93113e4bb` "Anthropic nears $1.5 billion joint venture with Wall Street firms" appears as M&A in one row and as Funding (`eb05ea3d-6d6a-4fe1-a0c5-50d7165b1d4a`) in another row for the same event picked up by different sources. The prompt does not currently disambiguate JVs.

Recommended diff at `backend/ingest.py:215`:

```diff
+JV (joint venture): label the article based on the article's framing. If the article frames the JV as an investment INTO a named company that will operate as a new entity (i.e. capital flowing into a new joint vehicle), use Funding. If the article frames it as a combination of operating businesses, use M&A. If purely a commercial / sales partnership with no equity, use Other. Default to Funding when ambiguous.
```

Place this immediately after the Funding bullet inside the deal_type description.

### Pattern 3.5: Hallucinated / placeholder `primary_company` values

Prevalence: population scan found 504 rows (15% of those with non-null primary_company, 10% of all rows in 21d) that contain corporate legal suffixes (Inc/LLC/Corp/Ltd), which is fine. But the random sample also turned up:
- `e6199fd7-d991-4c70-8a98-e7879e6c5119` primary_company = `"one AI Chip Stock"` (the article's clickbait headline read "1 [AI Chip Stock]")
- `5ef3daa0-b125-4c1b-b69a-cfc9b033f436` primary_company = `"NewCo"` (placeholder in the press release)
- `6a005512-7fac-4e58-b7c8-ce73f3dd2986` primary_company = `"Kevin Hart's Media Company"` (descriptive phrase)
- `25594aa0-ae43-4c3c-92a7-5ebe80c5ffd7` primary_company = `"Bullish"` (legitimate but collides with sentiment vocabulary; flag in entity gate)

The prompt at `backend/ingest.py:216` says "Never invent a name not present in the companies array" but does not say "never use a placeholder, descriptive phrase, or single-letter substitute."

Recommended diff at `backend/ingest.py:216`:

```diff
-Never invent a name not present in the companies array."
+Never invent a name not present in the companies array. Reject and return null if the candidate primary_company is: (a) a descriptive phrase such as "one AI chip stock", "the company behind X", "a Saudi delivery app"; (b) a placeholder such as "NewCo", "TargetCo", "Company A"; (c) a possessive descriptor such as "Kevin Hart's media company"; (d) a number-plus-noun headline pattern such as "1 AI Stock"; (e) a name composed only of a generic noun and an industry word."
```

### Pattern 3.6: Mixed-signal articles forced into a single deal_type when a secondary tag would be more useful

Examples include `cc94e653-5d82-45f3-9a84-2c7b4b578921` Nvidia smuggling allegations labeled Other (would be better as Regulation & Legal), and `ad782233-9d84-4548-8ac6-3a1a26493eb3` Musk-SEC settlement labeled Other (Regulation & Legal).

Root cause: the deal_type taxonomy collapses "Regulation & Legal" into "Other" at `backend/ingest.py:215` even though `ACTIVITY_TYPES` has it as a separate value. The article-level deal_type pill on the UI shows the deal_type, not activity_types, so this matters.

Recommended diff at `backend/ingest.py:215`:

```diff
-Other (regulatory action, product launch, contract award, partnership announcement, legal settlement, personnel change, analyst note, market commentary: catch-all for anything that does not clearly fit the above)
+Regulation (a named regulatory action: agency probe, settlement, consent decree, license review, ban, antitrust filing, sanction). Use this BEFORE Other.
+Other (product launch, contract award, partnership announcement, personnel change, analyst note, market commentary: catch-all for anything that does not clearly fit the above)
```

Plus a one-time backfill of existing rows where deal_type='Other' AND title regex matches probe/settle/ban/lawsuit/FTC/DOJ/SEC/FCC to reclassify as Regulation. Out of scope for this PR; track as filed-WD candidate WD66 in Section 7.

### Pattern 3.7: Sentiment driven by stock-reaction even when underlying event is bearish

Prevalence: showed up consistently in random samples. Examples: `2fc668e1-02b5-4e20-adb6-f5d3e940527b` GE HealthCare "Just Crashed 13% on a Guidance Cut. Here's the Case for Buying the Dip" labeled bullish; `ee8f5d27-ce62-43f0-8e1b-5c6773a835e7` "Airbus Missed Earnings and the Stock Is Up" labeled bullish; `52093c84-e9b5-43ec-ab2c-a8f7ab18d441` Eli Lilly recovers "after a patient ... experienced liver failure" labeled bullish.

Root cause: the prompt asks for `sentiment: bullish/bearish/neutral` without telling the model whether sentiment is about (a) the underlying event ("liver failure is bad"), (b) the market reaction ("stock recovered"), or (c) the article's editorial framing ("Buy the dip"). Different sources frame the same event differently, so the LLM picks whichever frame is loudest. This is the central WD49 gap. See Section 5.

## Section 4: Summary quality catalog

Reminder: the `summary` column is NOT LLM-generated. It is the RSS feed `description` HTML-stripped and capped at 500 chars (`backend/ingest.py:349` to `backend/ingest.py:361`, `backend/ingest.py:512`, `backend/ingest.py:543`, `backend/ingest.py:466`). There is no synthesis prompt to diff. WD59 is a feed/normalization audit, not a prompt audit.

Per-article quality scoring on the 115 reviewed:
- synthesized (a real lede sentence the LLM could have produced): 4
- extractive (RSS-provided one-or-two sentence description that lands intact): 79
- broken (truncated mid-word, dateline-prefix-only, source-boilerplate-only): 28
- hallucinated: 4 (these are RSS sources padding the description with adjacent items; not the LLM's fault but ends up in the field)

Population scan against the 21d corpus (5,074 articles) using `strip_html()` heuristics:
- 155 articles (3.1%) have NULL or fewer-than-40-char summary. The UI's `ArticlesRow.tsx:68` only shows the expand-toggle when summary is non-empty, so these collapse to title-only.
- 61 (1.2%) are SEC filing rows with summary = "Filed: YYYY-MM-DD AccNo: ... Size: __ MB" only.
- 127 (2.5%) are PR Newswire pieces where the dateline "CITY, STATE, [Month] [Day], [Year] /PRNewswire/--" eats 30 to 50 chars before any content begins.
- 23 are Yahoo-syndicated Investing.com rows that prefix the body with "Investing.com -- ".
- 4 still carry the `The post X appeared first on Y.` PE Hub boilerplate; the strip in `backend/ingest.py:358` catches the common case but not all variants.
- Anecdotal: Norwegian Cruise Line summary in `8c4808d5-e053-4197-b6a7-919b34b1f5dd` reads `"MIAMI {emdash} MIAMI {emdash} Norwegian Cruise Line ..."` (double dateline from upstream AP wire; the actual character in the row is U+2014).

| Pattern | Sample count | Population prevalence | Example IDs | Recommended fix at file:line |
|---|---|---|---|---|
| SEC 10-Q / 8-K summary is metadata only (`Filed: ... Size: __MB`) | 1 | 61 / 5074 (1.2%) | `2ee840f2-2a5e-43bf-8bf5-3218a7eb6536` | See diff 4.1 below |
| PR Newswire dateline-prefix noise | 6 | 127 / 5074 (2.5%) | `238caecf-6e29-4e49-ac09-e1e96f2bb9fa`, `5a6ff1b7-4b5f-43be-ad69-90b35884d898`, `f78bd6bf-51cb-4ada-9ad8-d5e2ade51b56` | See diff 4.2 below |
| Investing.com / Yahoo prefix noise | 2 | 23 / 5074 (0.5%) | `7de50638-5cc0-4fa8-9ccb-b27c76540a66` | See diff 4.2 below |
| Wire-service double dateline (`MIAMI {emdash} MIAMI {emdash}`) | 1 | not scanned | `8c4808d5-e053-4197-b6a7-919b34b1f5dd` | See diff 4.3 below |
| Truncated mid-word at 500 chars (UI shows ellipsis-less cut) | 11 | uncountable without re-running | `30db5616-b3d3-433b-9ce5-10577ad02156`, `c23df010-e7b3-4b89-b97e-7108a3b3077c` | See diff 4.4 below |
| RSS description is just a one-line teaser (less than 40 chars) | 8 | 155 / 5074 (3.1%) | `a2c868aa-6db6-490f-b057-73348fe8cc5c` (43 chars), many SEC rows | See Section 6, recommendation 4 |

### Diff 4.1: extract the actual filing description for SEC rows

The SEC RSS feed only puts metadata in `description`. The full text already gets fetched into `content` by `fetch_full_text()` for the SCRAPEABLE_SOURCES set (`backend/ingest.py:817` to `backend/ingest.py:830`). For SEC rows, when summary is the bare `Filed: ... AccNo: ... Size: __ MB` pattern AND content is populated, replace summary with the first 500 chars of content.

Recommended diff at `backend/ingest.py:822` (the existing enrichment loop) plus a tiny helper:

```diff
@@ backend/ingest.py:817 @@
     for aid, a in stored_pairs:
         if a["source"] not in SCRAPEABLE_SOURCES:
             continue
         try:
             full_text = fetch_full_text(a["url"], a["source"])
             if full_text:
-                supabase.table("articles").update({"content": full_text}).eq("id", aid).execute()
+                update_payload = {"content": full_text}
+                # SEC RSS summary is filing metadata only ("Filed: ... AccNo: ..."),
+                # not a human-readable summary. When we successfully fetched full text,
+                # promote the first 500 chars of content into summary so the
+                # ArticlesRow expand-row has something to show.
+                if a["source"].startswith("SEC ") and (a.get("summary") or "").startswith("Filed:"):
+                    update_payload["summary"] = full_text[:500].strip()
+                supabase.table("articles").update(update_payload).eq("id", aid).execute()
                 print(f"  Full text fetched: {a['source']} {a['title'][:50]} ({len(full_text)} chars)")
                 enriched += 1
```

### Diff 4.2: extend strip_html to peel dateline / prefix noise

Recommended diff at `backend/ingest.py:355` to `backend/ingest.py:360`:

```diff
@@ backend/ingest.py:355 @@
     text = re.sub(r"<[^>]+>", " ", text)                          # remove tags
     text = _html.unescape(text)                                    # decode &amp; &#038; etc.
     text = re.sub(r"https?://\S+", "", text)                       # bare URLs add no signal
     text = re.sub(r"\s*The post .+? appeared first on .+?\.\s*$",  # PE Hub boilerplate
                   "", text, flags=re.DOTALL)
+    # PR Newswire / Business Wire dateline. Forms: "CITY, ST, May 6, 2026 /PRNewswire/ --"
+    # and "LOS ANGELES, CALIF., May 6, 2026 /PRNewswire/--". Strip the dateline and the
+    # PRNewswire / BusinessWire marker so the actual body starts at character 0.
+    text = re.sub(r"^[A-Z][A-Z\.\- ]+,?\s+[A-Z][a-z]+\.?\s+\d{1,2},\s*\d{4}\s*/(PRNewswire|Business\s*Wire|GlobeNewswire)/\s*-{1,2}\s*",
+                  "", text)
+    # Investing.com syndication prefix.
+    text = re.sub(r"^Investing\.com\s*--\s*", "", text)
+    # "Month DD - " short-form dateline used by some wire syndications.
+    text = re.sub(r"^[A-Z][a-z]+\s+\d{1,2}\s*-\s*", "", text)
     text = re.sub(r"\s{2,}", " ", text)                            # collapse whitespace
     return text.strip()
```

### Diff 4.3: collapse double-dateline patterns

Same location as 4.2. Adds one more rule before the whitespace collapse:

```diff
+    # AP / wire double-dateline (e.g. "MIAMI {emdash} MIAMI {emdash}"): same token repeated.
+    # The {emdash} placeholder in this comment should be replaced with the literal U+2014 character
+    # when the diff is applied; the doc author avoided em-dashes per the W2-D constraint.
+    text = re.sub(r"^([A-Z][A-Z]+)\s*[-\u2014]\s*\1\s*[-\u2014]", "\g<1> \u2014", text)
```

### Diff 4.4: cleaner 500-char truncation

Currently truncation is hard slicing in the fetch sites (`[:500]`). Replace with a sentence-boundary or word-boundary truncation. Recommended helper added near `backend/ingest.py:361` and used wherever summary is sliced:

```diff
+def _truncate_summary(text: str, hard_cap: int = 500) -> str:
+    """Truncate at the last sentence boundary within hard_cap, falling back
+    to last word boundary. Preserves the ellipsis only when content was cut."""
+    if not text or len(text) <= hard_cap:
+        return text or ""
+    window = text[:hard_cap]
+    # Prefer last . ? or ! followed by a space or end-of-window
+    m = re.search(r"[\.\?\!]\s", window[::-1])
+    if m:
+        # m.start() is offset from the end
+        cut = hard_cap - m.start()
+        return window[:cut].rstrip() + "..."
+    # Fall back to last whitespace
+    last_space = window.rfind(" ")
+    if last_space > hard_cap * 0.6:
+        return window[:last_space].rstrip() + "..."
+    return window.rstrip() + "..."
```

Then replace each `[:500]` slice on `summary` text in `fetch_all_articles()` and `fetch_watchlist_finnhub_articles()` with `_truncate_summary(...)`:
- `backend/ingest.py:512`
- `backend/ingest.py:543`
- `backend/ingest.py:466`

## Section 5: Sentiment label audit (WD49)

### Where the relabel landed and where it didn't

C1b renamed the UI label from "Sentiment" to "Article tone" on the Company Detail surfaces. The text label change is at:
- `src/components/company/CompanyKPIStrip.tsx:154` ("Article tone")
- `src/components/company/CompanyTrendCard.tsx:164` ("Article tone")
- `src/components/company/ArticlesTable.tsx:6` (comment refers to "tone" column)

What did NOT change:
- The DB value remains `bullish | bearish | neutral`. Schema confirmed via `information_schema.columns`. Values seen in 21d: bullish 2376, neutral 1533, bearish 1165.
- The prompt at `backend/ingest.py:214` still asks for `sentiment: bullish/bearish/neutral`. The prompt does NOT define which of three possible reference frames it wants (event tone, market reaction, editorial framing). See pattern 3.7.
- Other surfaces that have NOT been relabeled still say "sentiment":
  - `src/components/dashboard/story-card.tsx:71`, `:86`, `:128`, `:358` use `sentimentToVariant`/`sentimentLabel` and render a `Badge` not a `SentimentPill`. The Badge label is one of "Bullish/Bearish/Neutral/Risk-off/risk-on".
  - `src/components/feed/feed-row.tsx:16`, `:31`, `:42`, `:92` same pattern.
  - `src/components/brief/brief-pdf.tsx:30` exposes a `sentiment_word` field.
  - `src/components/landing/landing-page.tsx:21`, `:34`, `:44`, `:54` use the words "bullish/bearish/risk-off" directly. Landing page is fixture content; lower priority.
  - `src/components/track-record/verdict-evolution.tsx:17` uses `weighted_sentiment_alignment`. Different concept (thesis grading), but if the rename is brand-wide we should at least audit the user-facing string.

### The deeper mismatch surfaced by pattern 3.7

"Tone" as a UI label sets the user's expectation that the chip describes how the article READS (its prose tone toward the company). The stored value is closer to a market-reaction signal. Examples that prove the mismatch:
- `2fc668e1` stock crashed 13% on a guidance cut; article framed as "buy the dip" by an analyst; stored sentiment = bullish; pill shows BULLISH next to a 13% drop headline. A user reading the page sees BULLISH and reads a guidance-cut headline.
- `52093c84` patient on Lilly weight-loss pill "experienced liver failure"; stored sentiment = bullish (because Lilly stock recovered). Pill renders BULLISH next to a liver-failure headline.
- `ee8f5d27` "Airbus Missed Earnings and the Stock Is Up." Pill says BULLISH next to "Missed earnings."

These are not bugs in the LLM. The prompt does not specify which sentiment frame to choose. The UI relabel made the mismatch visible.

### Recommended sentiment changes (ordered)

Option A (low effort, highest immediate clarity): rewrite the sentiment field of the prompt to use the EVENT frame explicitly. Diff at `backend/ingest.py:214`:

```diff
-  "sentiment": "bullish/bearish/neutral",
+  "tone": "bullish | bearish | mixed | neutral. Evaluate the EVENT described, not the article's editorial framing or any analyst opinion. If the article reports an event whose first-order impact on the named primary_company is positive (beat, contract win, regulatory approval, raise, accretive acquisition, favorable settlement), tone is bullish. Negative first-order impact (miss, guidance cut, probe, recall, layoff that signals stress not strength, downgrade, adverse legal outcome) is bearish. Mixed: same article describes both a positive and a negative event that materially offset. Neutral: scheduling, calendar, or non-directional commentary. Do NOT pick tone based on stock price reaction or analyst opinion alone; if the article's only signal is 'stock is up/down', return neutral.",
```

Option A also requires renaming the schema field from `sentiment` to `tone` in `FilterDecision` (`backend/ingest.py:72`) and adapting the read site `analysis.get("sentiment", "neutral")` at `backend/ingest.py:755` and `backend/ingest.py:765` and `backend/ingest.py:770`. The DB column would stay `sentiment` for now to avoid a migration, with the read renamed. Filed as a follow-up.

Option B (out of scope this PR, larger change): introduce a `MIXED` value in the DB column and add it to the UI mapping. The `SentimentPill` already has a `MIXED` variant defined at `src/components/ui/sentiment-pill.tsx:16`. The toTone() map at `src/components/company/ArticlesRow.tsx:31` to `:35` would need a `mixed -> MIXED` entry. The data-access scoreSentiment at `src/lib/data-access/getCompanyDetail.ts:56` would need to choose a numeric mapping for MIXED (recommend `0` so it shows as neutral in the 7d aggregate but distinct in the per-row pill).

Option C (out of scope): expose `sentimentFrame` separately from `sentiment`, so the UI can show two pills (event tone, market reaction). Probably over-engineered. Mention only because the brief-pdf and story-card flows already mix the two frames silently.

### Where the relabel left lingering UI bugs

Even before fixing the prompt, the following UI files still call the column "sentiment" in labels visible to the user:
- `src/components/dashboard/story-card.tsx:128` and `:358` show a Badge whose hover text says "sentiment" in some accessibility paths. Verify with axe pass.
- `src/components/feed/feed-row.tsx:92` same.
- `src/components/brief/brief-pdf.tsx:30` exposes `sentiment_word` to the PDF template; rename pending.

Recommended changes are listed in Section 6 priority order. No DB migration is required for the relabel itself.

## Section 6: Prioritized prompt-tuning recommendations

Ordered by estimated quality lift per unit of work. Higher number means higher priority.

1. **(P0) Tighten the Earnings clause to exclude analyst notes, pre-earnings previews, listicles, and scheduling press releases.** Pattern 3.1, prompt diff at `backend/ingest.py:215`. Expected lift: turns ~30% of the Earnings bucket from `wrong` to `correct`, redistributing those rows mostly to Other. Effort: 1 prompt-line change, no schema change.

2. **(P0) Define the sentiment frame as EVENT, not stock reaction.** Pattern 3.7 and Section 5, diff at `backend/ingest.py:214`. Expected lift: makes the Article-tone pill consistent with the headline a user reads next to it. Effort: 1 prompt change, no DB migration needed if we keep the column name `sentiment`.

3. **(P1) Harden the primary_company guard against descriptive phrases and placeholders.** Pattern 3.5, diff at `backend/ingest.py:216`. Expected lift: eliminates 1 to 2% of pages where the Company chip says "one AI Chip Stock". Effort: prompt-only.

4. **(P1) Rewrite strip_html to peel dateline / prefix / boilerplate noise.** Pattern 4.2 / 4.3, diff at `backend/ingest.py:355`. Expected lift: cleans ~150 rows / 3% of the corpus; the ArticlesRow expand-row stops opening on "[CITY], May 6, 2026 /PRNewswire/--". Effort: regex additions in one function.

5. **(P1) SEC filing rows: promote first 500 chars of content into summary when summary is bare `Filed: ...` metadata.** Pattern 4.1, diff at `backend/ingest.py:822`. Expected lift: 61 rows / 1.2% in the last 21d, and a steady drumbeat going forward as SEC ingestion is daily. Effort: 4-line update payload tweak.

6. **(P2) Split out `Regulation` from `Other` in the deal_type taxonomy.** Pattern 3.6, diff at `backend/ingest.py:215`. Expected lift: 5 to 8% of the Other bucket reclassifies cleanly; existing UI chip styling already handles arbitrary deal_type text. Effort: prompt change plus backfill migration (out of scope this PR; track as WD66).

7. **(P2) Add a JV disambiguator rule (Funding vs M&A vs Other).** Pattern 3.4, diff at `backend/ingest.py:215`. Expected lift: small but reduces the inconsistency where the same event lands in two different buckets depending on source. Effort: prompt-only.

8. **(P2) Tighten IPO clause for ETFs / fund launches.** Pattern 3.3, diff at `backend/ingest.py:215`. Expected lift: small (~6 articles / 21d). Effort: prompt-only.

9. **(P3) Truncate summary at sentence or word boundary.** Diff 4.4. Expected lift: small but improves the look of the expand-row. Effort: 1 helper plus 3 call-site swaps.

10. **(P3) Source-quality blocklist for `Naturalnews.com`, `Globalresearch.ca`, `Crypto Briefing`, `Bitcoinfoundation.org`, `Futurism`, `Om.co`.** Add to the keyword pre-filter (`backend/ingest.py:292`) or to a sources blocklist. Expected lift: removes ~25 low-credibility rows / 21d. Effort: small.

## Section 7: Filed-WD candidates

These are new WD entries Noah should consider in addition to WD49 / WD59 / WD63 already covered above.

- **WD64 (filed): Earnings prompt tightening.** Implements recommendation P0 #1. Single-line prompt edit at `backend/ingest.py:215`. No migration.

- **WD65 (filed): Sentiment frame definition (event vs reaction).** Implements P0 #2. Prompt edit at `backend/ingest.py:214`. Keep DB column name; rename UI label only on surfaces still calling it "sentiment".

- **WD66 (filed): Regulation bucket reintroduction in deal_type taxonomy.** Implements P2 #6. Includes a one-off backfill migration to relabel `Other` rows where title matches probe/settle/ban/lawsuit/FTC/DOJ/SEC/FCC regex. Out of scope for the doc-only PR.

- **WD67 (filed): strip_html prefix peeling.** Implements P1 #4. Code change in `backend/ingest.py:355` plus a one-time backfill that re-runs `strip_html()` on existing rows. Backfill is optional; new rows benefit immediately.

- **WD68 (filed): SEC summary backfill from content.** Implements P1 #5. Code change at `backend/ingest.py:822` plus a one-time backfill SQL/Python to populate summary for the existing 61 rows.

- **WD69 (filed): primary_company hallucination guard tightening.** Implements P1 #3. Prompt edit at `backend/ingest.py:216`. Add a small Python post-validator after `extract_company_names()` at `backend/ingest.py:321` to reject descriptive-phrase patterns even when the model returns them.

- **WD70 (filed): low-quality source blocklist.** Implements P3 #10. Add domains to `_INGEST_KEYWORD_BLOCKLIST` or create a new `SOURCE_BLOCKLIST`.

- **WD71 (filed): JV deal_type disambiguator.** Implements P2 #7. Prompt-only.

- **WD72 (filed): IPO clause for ETFs and over-allotments.** Implements P2 #8. Prompt-only.

- **WD73 (filed): UI-side sentiment label completeness sweep.** Rename remaining "sentiment" user-facing strings in `src/components/dashboard/story-card.tsx`, `src/components/feed/feed-row.tsx`, `src/components/brief/brief-pdf.tsx`, optionally `src/components/landing/landing-page.tsx`. No DB change.

- **WD74 (filed): consider exposing `relevance_reason` in the UI.** The pipeline already produces a rich per-article rationale and stores it; the UI never shows it. The ArticlesRow expand-row currently shows the RSS-derived summary (which has all the quality problems above). Showing relevance_reason instead, or alongside, would surface an LLM-synthesized take that ALREADY exists. No new prompt work needed; just thread the column through `getCompanyDetail.ts` and into `ArticlesRow.tsx`. Sample shows the rationale is generally specific and useful (see Earnings examples in Section 3).

- **WD75 (filed): consider an article-level synthesized lede prompt.** If we want a TRUE per-article summary (today there is none, only the RSS description), introduce a new Gemini call that takes title + summary + first ~1000 chars of content (when present) and emits a one-sentence buy-side lede. Likely overkill for now given WD74 is free.

## Halts

None. No PII discovery. Audit examples in this doc use article IDs plus short title snippets only; no paywalled content is reproduced. No compliance issues.

## End matter

- Sample N actual: 115 manually scored + aggregate scans across 5,074 rows.
- Headline classification accuracy: 60% strict, 79% strict-or-borderline.
- Top 3 failure patterns:
  1. Analyst notes and pre-earnings previews labeled `Earnings` (~30% of the Earnings bucket).
  2. Sentiment driven by stock reaction or editorial frame rather than event semantics (Article tone pill mismatches the headline next to it).
  3. RSS-derived summary contains wire-service dateline / PRNewswire / SEC-filing-metadata noise (~5% of all rows) before content begins.
- Top 3 prompt-tuning recommendations:
  1. Tighten `Earnings` clause to exclude analyst recommendations, pre-earnings previews, scheduling press releases, and listicles. `backend/ingest.py:215`.
  2. Define sentiment frame as the EVENT, not the stock reaction. `backend/ingest.py:214`.
  3. Harden `primary_company` against descriptive phrases and placeholders. `backend/ingest.py:216`.
