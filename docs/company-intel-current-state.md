# Company Intel - Current State + Improvement Opportunities

Audit date: 2026-04-30
Branch: `w2/company-intel-current-state` (read-only audit)
Worktree: `/Users/noahhanning/ba-w2-cintelaudit`
Auditor: Claude (Wave 2, Agent 1 - user-facing Company Intel experience)
Cross-agent split: Agent 3 owns `docs/entity-resolution-audit.md` (canonical entity layer); Agent 4 owns `docs/track-record-evidence-audit.md`. This audit does not duplicate either; it focuses on the user-facing experience, the gap to the bar, and the strategic call for the overhaul.
Live access: signed-in walk of the detail flow was NOT possible. The signed-out preview surface was reachable on `signalera.ai` and is documented from a real browser session (screenshots in `docs/company-intel-screenshots/`). All signed-in observations are explicitly labeled `[code-derived]`.

---

## TL;DR (read this first)

The product has one strong artifact (Generate Memo) and roughly six weak surfaces around it (discovery, search, query-an-arbitrary-company, refresh, mobile, persistence, comparison, leadership/financials/funding depth). Measured against Noah's bar - "look up any company you can think of and it'll be enough, better than Google" - Company Intel today is **not in the same product category as Google**. It is a curated 441-company directory that produces a high-quality memo if and only if (a) the company has been ingested by the news pipeline and (b) the user already knows to navigate to `/company`.

The single highest-leverage move is to break the indexed-only constraint: any user-typed company should produce an answer, even if no rows exist in `companies`. Today, typing `Stripe`, `Anduril`, `Mistral`, or `Perplexity` in the only search box on the page cannot return them at all because they are not in the curated `CANONICAL` map and have not been written to the `companies` table by Gemini (private companies show up only when a story names them, and even then they sit in the same junky list as 441 others sorted by mention count).

The strategic recommendation at the bottom of this document is **Strategy C (hybrid: memo-led with directory depth) with a web-search fallback for un-ingested companies**, because it preserves the strongest artifact (the memo) while plugging the largest gap (the bar).

---

## 1. What the user actually sees today

### 1.1 Discovery / landing - `/company` (public)

Source: live walk on `https://signalera.ai/company` (signed-out), backed by `src/app/company/page.tsx`.

- The page renders a hero header ("Company Intel"), a one-line caption, and a 3-column grid of 441 companies sorted by Supabase `mention_count` desc, then `last_updated` desc, then alphabetical (`src/app/api/companies/route.ts:40-46`).
- Top 6 tiles right now: OpenAI 180x, Anthropic 176x, Meta 116x, Alphabet 112x, Amazon 87x, NVIDIA 76x. No price, no sector chip, no recency hint, no logo, no founder, no funding stage - just `name + mention_count`. Tile content is `name + Nx pill`, nothing else (`src/app/company/page.tsx:531-555`).
- Sort is purely "loud in our news pipeline this window," not "important to the user." A heavily-covered private name (OpenAI) outranks every Fortune 50 company.
- Industry filter chips exist (11 verticals, hardcoded list `src/app/company/page.tsx:76-88`), with Match Any / Match All toggle when 2+ are selected. Two-layer mapping (overrides for ~80 well-known names + sector→vertical fallback) - works fine for known names; nothing for the long tail.
- Signed-out users see only the top 6 tiles plus a "Sign in to see all 441 companies" gate. Search and filters are visually locked (lock icon + "Search available after sign in"). Screenshot: `docs/company-intel-screenshots/01-landing-signed-out.png`.

### 1.2 Search behavior

Source: `src/app/company/page.tsx:264-284` + `src/app/api/companies/route.ts`.

- One input. 250ms debounce. Calls `/api/companies?q=<term>&limit=50` which runs a single `ilike("name", "%term%")` against the `companies.name` column.
- **Hard constraint**: only returns companies that have been written to the `companies` table by `backend/ingest.py:upsert_company()`. Companies that have never appeared in an ingested article do not exist in this dataset and cannot be found by typing them.
- Ticker search is intentionally disabled (`src/app/api/companies/route.ts:48-52` comment: "Ticker filtering deliberately omitted - column reliability is unverified per the fix plan; revisit in a follow-up"). So "AAPL" finds nothing useful even though "Apple" works.
- No fuzzy match, no synonym expansion ("OpenAI Inc" only matches because the canonicalizer strips it post-fetch, not because the search query was expanded). Search for "GPT", "ChatGPT", or "Sam Altman" returns nothing, even though articles about all three are indexed.
- Per the audit context, Stripe was unfindable on the Ticker tab - same root cause: the canonical entity layer is not behind the search box, and there is no fallback path to "company you might mean."

### 1.3 Click into a company - detail view (signed-in)

Two distinct paths exist:

**Path A: side panel** (when the user is on `/company` and clicks a tile). Renders inline in `src/app/company/page.tsx:589-789`. Fetches `/api/companies/${name}/articles` (cache-first via `watchlist_articles` keyed on `identifier ilike <canonical>`, fallback to `articles.companies @> [name]`, both capped at 50 rows - `src/app/api/companies/[id]/articles/route.ts:25-80`). Then classifies into "Company Events" (Earnings, M&A, Funding, IPO with strict actor rules - `src/lib/company-intel.ts:521-585`) and "Sector Context."

**Path B: full route `/company/[id]`** (`src/app/company/[id]/page.tsx`). Server-rendered. Uses the same `fetchCompanyArticles` helper, the same classifier, the same memo content builder. Renders via `CompanyDetailClient` (`src/components/company/company-detail-client.tsx`). Shows industry tag (only for companies in `COMPANY_IDENTITY`), totalArticles, the same Company Events / Sector Context split, the same Add to Watchlist + Generate Memo buttons.

What the user sees in either path:
- Header: company name, mention count, "Add to Watchlist" + "Generate Memo" actions.
- Articles: each article card shows source, deal_type tag (Event/Earnings/M&A/Funding/IPO), timeAgo, completeness pill (Full text/Summary/Headline only), Signal score (out of ~10), source credibility win-rate.
- Sparse-evidence notice when zero developments found (`src/app/company/page.tsx:660-669`): "No company events in this feed window. {Company} appears in N sector context articles."
- Screenshot of OpenAI detail (signed-out preview path): `docs/company-intel-screenshots/02-openai-detail-signed-out.png`.

What the user does NOT see (live for any company today):
- Price / market cap / 52-week range / today's move.
- Founders, CEO, board, leadership team.
- Funding history (last round, valuation, lead investors).
- Customer/partner mentions, competitor map.
- Recent product launches, regulatory filings, hiring signals, HQ moves.
- Comparison-with-peer view.
- "Why does this company matter?" elevator pitch (only the curated `COMPANY_IDENTITY.brief` for ~30 companies - `src/lib/company-intel.ts:255-297`).
- Latest news in the last 24h, distinct from "in the current ingest window" (which can be 7-14 days old depending on pipeline cadence).
- Any source other than the Signalera news pipeline (no Wikipedia, no SEC filings, no Crunchbase, no LinkedIn, no Glassdoor, no S-1, no transcript, no analyst reports).

### 1.4 Generate Memo flow

Source: `src/components/memo/MemoModal.tsx` + `src/app/api/memo/route.ts`.

- Click triggers a POST to `/api/memo` with `{ content: memoContent, type: "company", systemPrompt: buildMemoSystemPrompt(name) }`.
- Server merges historical context (recent thesis outcomes, top-3 sources by win rate, top-3 patterns for sector - `src/app/api/memo/route.ts:139-203`) and a role-aware user-profile overlay (student/buy-side/sell-side/PE - `src/app/api/memo/route.ts:46-104`). This is real personalization. Lucas-touchable.
- Calls Gemini 2.5 Flash with `temperature=0.35`, `maxOutputTokens=750`, `thinkingBudget=0` (`src/app/api/memo/route.ts:291-299`).
- Loading state: full-page-ish modal opens immediately, body shows a single spinner (`MemoModal.tsx:251-254`). No streaming, no "thinking," no typing animation, no skeleton, no progress signal. Sit-and-wait UX for ~3-8 seconds.
- Render: `react-markdown` with bold-h3-as-gold-tracking-uppercase styling. After load, sections fade in with a 180ms-stagger ink animation (`MemoModal.tsx:176-191`). Looks editorial. This is good.
- Footer: Copy + Export .md + Close. Screenshot of the memo modal (signed-out gates to sign-in): `docs/company-intel-screenshots/03-memo-signed-out-prompt.png`.
- **No timestamp on the memo. No "memo generated 14:32 PT, based on 9 articles ingested 2d-7d ago." No "regenerate." No "memo from yesterday is cached."** Each click re-spends Gemini budget. There is no `company_memos` table or equivalent - the WatchList feature does cache to `watchlist_briefs` (`src/app/api/export/company-pdf/route.ts:33`), but the Company Intel page does not use it.
- **No provenance**: the user cannot click "where did the 'OpenAI missed revenue target' claim come from?" and land on the source article. The articles are listed below the memo button, not embedded in the memo.
- Rate limit: 10 memos / 24h per user (`src/app/api/memo/route.ts:227`). Admins bypass.

### 1.5 Try a company NOT in the system

This is the bar test. Both screenshots and code analysis converge on the same answer: the user has nowhere to go.

[code-derived] Path attempted as a signed-in user typing `Anduril` in the search box at `/company`:
1. The 250ms debounce fires.
2. `/api/companies?q=Anduril&limit=50` runs `ilike("name", "%Anduril%")` against `public.companies`.
3. If Anduril has never been mentioned in an ingested article, the response is `{ companies: [] }`.
4. The grid replaces with the `EmptyState` component: "No companies match. Try a different search term." (`src/app/company/page.tsx:524-529`).
5. There is no "Did you mean…" suggestion. There is no "Generate a memo from web search" CTA. There is no link to Finnhub-style search. There is no Clearbit-style logo lookup. There is no fallback to GDELT (`src/app/api/news-search/route.ts` exists but is not wired to Company Intel discovery - only the `/intelligence` chat uses it). The user is stuck.
6. If the user types the URL `/company/anduril` directly, `slugToCompanyName("anduril")` → "Anduril" (title-case fallback), `fetchCompanyArticles` returns 0 rows, the page renders "0 articles in current feed window" with the "No articles found" empty state (`src/components/company/company-detail-client.tsx:132-138`). Generate Memo is disabled with toast "No articles found for this company - memo cannot be grounded" (`src/components/company/company-detail-client.tsx:84-90`).

This is the largest single gap to the bar. A user testing Signalera for 60 seconds will type a company they care about, find nothing, and conclude the product covers a fixed list. The answer they wanted ("what does Anduril do, who runs it, what just happened?") is one Gemini call away.

### 1.6 Mobile (375-414px)

Source: live walk at 390x844 (`docs/company-intel-screenshots/04-mobile-signed-out.png`, `05-mobile-detail-openai.png`).

- The 3-column tile grid does not collapse to 2 or 1 column. At 390px wide, tile names are visually truncated to 3 characters: "Op...", "Ant...", "Alp...", "Ama...", "NVI...". Mention count badge eats the rest of the cell. **Unreadable**.
- Detail view becomes full-page (the desktop side-panel pattern collapses) but article card metadata row overflows horizontally - "Headline only" badge + "Signal:" pill + source-credibility pill all fight for the same horizontal budget; "Signal:" is clipped.
- Bottom nav (`src/components/shell/mobile-bottom-nav.tsx:27-39`) does NOT include Company Intel in the 5-item primary row. It is shoved to the "More" overflow. So mobile users have to know it exists to find it.
- The signed-out top-right "Sign in free" button overlaps the mood-bar text under Markets steady at this width (mood headline "Loading..." truncates).

### 1.7 Refresh, freshness, provenance - none of it

- No timestamp on the company tile ("last update 2h ago" / "last update 9d ago").
- No "stale data" warning. The `articles` row's `ingested_at` is the only timestamp surfaced; the memo treats them as a snapshot but never tells the user when the snapshot was taken.
- No "refresh now" affordance on the company detail.
- The watchlist-articles cache (`watchlist_articles`) is populated by `backend/watchlist_sync.py` on the 13th step of the pipeline. Company Intel reads from this cache for the side-panel articles list - but if a company isn't in any user's watchlist, the cache is empty for it and the fallback is a `articles.companies @> [name]` query against the global articles table. There is no "the cache is N hours old" badge.
- No "you generated a memo for this company yesterday - view it" history. No memo persistence at all (see 1.4).

---

## 2. Code path inventory (read-only reference)

| Surface | File | Notes |
|---------|------|-------|
| Landing | `src/app/company/page.tsx` (810 LOC) | Client component. Two `useEffect`s: top-100 load (`/api/companies?limit=500`) and debounced server search. Two-layer industry filter (overrides + sector→vertical map). Side-panel detail via `setSelectedCompany`. |
| Detail (full-page) | `src/app/company/[id]/page.tsx` | Server component. `slugToCompanyName` → CANONICAL lookup → title-case fallback. Reuses `fetchCompanyArticles`, `filterAndClassifyArticles`, `buildMemoContent`. |
| Detail UI | `src/components/company/company-detail-client.tsx` | Client component. Mirrors the side-panel rendering. Holds memo modal state. |
| Stub tabs | `src/components/company/company-tabs.tsx` | Defines five tabs (Live Developments, Research & Theses, Deal Memos, Metadata, Monitoring) but **is not used anywhere** - dead-code stub for the originally planned tabbed layout. Worth deleting or wiring up. |
| Stub header | `src/components/company/company-header.tsx` | Defines a price/marketCap/change-aware header - also **not used by `/company/[id]`**. Suggests the original spec included real ticker data and was deferred. |
| List API | `src/app/api/companies/route.ts` | `name ilike` only. Filters `name IS NOT NULL` and `mention_count IS NOT NULL`. JS-side noise filter (numeric/punct/short-lowercase). Logs warning if >30% rows dropped. |
| Articles API | `src/app/api/companies/[id]/articles/route.ts` | Cache-first (`watchlist_articles` join `articles`), fallback to `articles.companies @> [canonical]`. Caps at 50. Exported as `fetchCompanyArticles` for SSR. |
| Memo API | `src/app/api/memo/route.ts` | Gemini 2.5 Flash, role-personalized prompt, historical context overlay, 10/day rate limit. Type: `company` uses `systemPrompt` from `buildMemoSystemPrompt()`. |
| Pure logic | `src/lib/company-intel.ts` (796 LOC) | CANONICAL map, COMPANY_IDENTITY map (~30 companies), JUNK_WORDS / blocklists / abstract-phrase filters, `canonicalize`, `parseCompanies`, `matchesCanonical`, `isSubjectOfTitle`, `titleNamesCompany`, `filterAndClassifyArticles`, `buildMemoContent`, `buildMemoSystemPrompt`. |
| Backend writes | `backend/ingest.py:631-650, 661-721` | `upsert_company` (companies table), `store_article` (articles + company_mentions). Also: blocklist + Wikidata gate, `extract_company_names`, primary_company classification. **Read-only audit - not edited.** |

Loading and error states summary:
- Loading: 6-tile skeleton on initial list load, 3-card skeleton on detail panel article load, single spinner on memo generation. All consistent visually.
- Error: list fetch failure → empty grid + console.error. Articles failure → empty list + console.error. Memo failure → red text in modal "Failed to generate memo" + Close button. None of these show the user a recoverable path (no "Retry" CTA).

Auth:
- `/company` is a `isPublicPath` (`src/proxy.ts:34`) and renders a preview for signed-out (top 6 tiles, search/filters locked, all interaction gated to a sign-in modal).
- `/company/[id]` is NOT in the public path list, so signed-out users hitting a deep link are redirected to `/auth`. Confirmed live by navigating to `https://signalera.ai/company/stripe` while signed-out - landed on `/auth`. This breaks share-the-link UX.

---

## 3. Data depth per company - what exists vs what should exist

### What exists in Supabase per company today

From `backend/ingest.py` and the schemas in `backend/*.sql`:

- `companies.{id, name, mention_count, last_updated, key_themes, sentiment_trend, sector, ticker?}` - `ticker` column reliability is "unverified per the fix plan" (`api/companies/route.ts:50`). `sector` column is populated from the article's first industry vertical, single-valued.
- `company_mentions.{company_id, article_id, context, sentiment}` - one row per article-company link.
- `articles.{title, summary, content, source, sector, sentiment, companies[], primary_company, deal_type, relevance_score, published_at, ingested_at, url, content_type}` - the actual evidence pool. `content` is full-text when available; otherwise the row is "Headline only" or "Summary."
- `watchlist_articles` - per-identifier pre-fetched articles from Finnhub + Exa + GDELT (with relevance scoring) - only populated for identifiers in user watchlists.
- `watchlist_briefs` - cached LLM brief per identifier - only populated for watchlist users, and **not surfaced on `/company/[id]`**.
- `source_credibility.{source, win_rate, sample_size}` - per-source historical win rate, used for the gold pill in article cards.

So the answer to "what data exists" is honest: a curated text-trail of articles and their classifications, plus a derived mention count. There is no structured company entity. There is no "OpenAI is private, last priced at $X, founded year Y, CEO Z, 5,000 employees, last raised $Y from W" record anywhere in the system.

### What's missing that a user expecting "better than Google" would want

In rough order of "this is the obvious gap a user will notice in 60 seconds":

1. **Founders / CEO / leadership** - entirely absent. Even for Apple. Even for OpenAI. Not in `COMPANY_IDENTITY`, not in any sidecar table, not extracted from articles.
2. **Funding history for private companies** - Stripe / OpenAI / Anthropic / SpaceX have no rounds, no valuation, no lead investors anywhere in the product. Articles about funding events exist; they are not aggregated into a "Funding rounds" section.
3. **Price / market cap / day-change for public companies** - Finnhub data is fetched in `ticker-context` route for the Thesis Board, but never on `/company/[id]`. The header would render it (`company-header.tsx`) - but that component is unused.
4. **Latest news in last 24h** - the article window is "whatever was ingested," with no 24h filter or "what changed today" section. A user asking "what happened to Tesla this morning" will see articles from up to 14 days ago mixed with today's.
5. **Competitor map** - no peer list anywhere. The memo's Cross-Signals section mentions peers only when articles in the pool happen to name them.
6. **Hiring signals / HQ moves / regulatory filings / product launches** - none of these are extracted as structured signals. They live as free-text summaries inside articles, and only surface if Gemini happens to lean on them in the memo.
7. **Why does this company matter? (elevator pitch)** - only available for the ~30 companies in `COMPANY_IDENTITY`. Stripe, Anduril, Mistral, Perplexity, Databricks, Canva, ByteDance, Revolut, Klarna, Plaid, Wise, Brex, Ramp - all absent. The Analyst Brief opener prompt rule **explicitly bans** describing what the company does, so even a curated brief gets less surface area in the memo than the user might want.
8. **Comparison view** - no two-company side-by-side anywhere in the product.

---

## 4. Gap analysis vs the bar - Today vs Bar, by scenario

| Scenario | Today | Bar ("better than Google for any company") | Gap |
|----------|-------|---------------------------------------------|-----|
| Search "Anduril" | Empty grid + "No companies match" | Returns Anduril card with founder Palmer Luckey, ~$14B last valuation, last news in 24h, "what just changed" memo grounded in web search if no internal articles | Need un-ingested-company fallback (web search → memo) and an entity layer that knows companies exist outside the news pipeline |
| Compare Stripe vs Adyen | Cannot. No comparison view, both partially indexed | Side-by-side: founders, valuation, customers, recent news, memo on the contrast | Need comparison primitive + better private-company data |
| Latest news on NVIDIA in last 24h | Mixed window - articles from 0-14d ago in one list, no recency filter | Sectioned: today / this week / this month, with a "live" tag on most recent | Need recency filtering + auto-refresh signal |
| Founders / leadership for Anthropic | Absent | "Dario Amodei (CEO), Daniela Amodei (President), founded 2021 by ex-OpenAI safety team" | Need leadership extraction (Wikidata or web search) |
| Funding history for Stripe | Absent | "Last round: $6.5B at $50B post in March 2023; lead Goldman Sachs; total raised $9B over 14 rounds" | Need funding-round extraction (Crunchbase-class data or web search) |
| Mobile UX | 3-col grid truncates names to 3 chars; detail metadata overflows; not in primary nav | 1- or 2-col tile grid with full names; mobile-sheet detail; reachable from mobile nav | Pure CSS / nav fix |
| Competitor analysis | Memo names peers only if articles do; no map | "AMD, Intel, custom-silicon programs at AWS/Google" with each clickable | Need peer-graph extraction; competitive intelligence layer |
| Elevator pitch ("why this company matters") | Curated for ~30 companies; banned in the memo opener | Always available; one-line, one-paragraph, one-page versions | Need fallback to Wikidata/Wikipedia summary or web-search summary for un-curated companies |
| Share a link to a company | `/company/[id]` is auth-gated; signed-out users redirected to /auth | Public preview page with one Gemini-grounded memo, sign-in for full | Add `/company/[id]` to public allowlist with progressive disclosure |
| Refresh / "what changed since last memo" | No timestamp, no refresh, no diff | "Last memo 2h ago. 3 new articles since. Refresh?" | Need memo persistence + delta indicator |

The pattern: every "today" cell either says "absent" or "indexed-only." The bar requires a fallback path that does not depend on the curated index.

---

## 5. Memo strengths to preserve (do not regress)

The memo is genuinely good. Anything we change must not weaken these patterns:

1. **Sourcing discipline** (`src/lib/company-intel.ts:742`). The system prompt has a hard "every figure must be in the article pool, omit if uncertain, do not blend training knowledge" rule that is repeated three times in different framings within the same paragraph. This is the single most important quality control in the product. Any web-search fallback we add MUST inherit this pattern (label web-derived facts, do not let them blend with article-derived ones).

2. **Mode switching: developments-led vs context-led** (`src/lib/company-intel.ts:680-726`). When at least one Earnings/Funding/IPO event exists, the memo opens with "What Just Changed"; otherwise it folds borderline developments into context and opens with sector framing. This is a real two-shape product, not a one-shape prompt.

3. **Curated identity for ~30 names** (`COMPANY_IDENTITY` map, `src/lib/company-intel.ts:255-297`). When present, this gives the model a known-true industry tag and a one-sentence brief used as grounding context. This prevents the model from inventing a sector for NVIDIA. **The list is too short - Stripe, OpenAI's IPO posture, Anthropic's enterprise pivot, SpaceX's Starlink revenue, etc. - but the pattern is right.**

4. **Article ranking by company-specific signal** (`contextScore` + `selectContextArticles`, `src/lib/company-intel.ts:606-647`). Caps context articles at 4 and ranks by "company name in title (+3) > first significant word (+2) > development deal type (+2) > general relevance ≥ 8 (+1)". Prevents diluted memos when 30 incidental mentions overwhelm 3 real-signal articles.

5. **Hard banned phrases + opener rules** (`src/lib/company-intel.ts:737-749, 793`). Bans "may benefit," "is poised to," "investors are watching," etc. Forces a market-first opener (proper noun or specific figure first). Bans the em-dash. Bans bullet points outside "What To Do With This." Bans markdown headers beyond bold labels. This is the difference between a memo that reads like Bloomberg Brief and one that reads like a corporate boilerplate.

6. **Binary verdict requirement in Cross-Signals** (`src/lib/company-intel.ts:759, 776`). The model is forced to write "Sector momentum [supports/does not support/is net negative for] {Company}'s {aspect} in the {timeframe}" - and explicitly told that "mixed/presents/both/while" counts as a hedge that must be rewritten. This is the rare prompt that forbids fence-sitting.

7. **Two-bullet trigger structure in "What To Do With This"** (`src/lib/company-intel.ts:761-763, 778`). "If [trigger]: [thesis confirmation + action]. If [opposite]: [why thesis weakens]." Forces a probabilistic stance. ≤75 words per bullet.

8. **Role-aware personalization** (`src/app/api/memo/route.ts:46-104`). Student gets a Bear Case + Watch list framing; buy-side gets a Trade + Comparable Situations framing; sell-side gets a Recommendation + Rating framing; PE gets an IC memo framing. This is real product depth that no competitor in the news space has.

9. **Historical context overlay** (`buildMemoContext`, `src/app/api/memo/route.ts:139-203`). Recent thesis confirmation rate by sector + top-3 sources by win rate + top-3 patterns by sector get prepended to the system prompt. This is what makes the memo feel "researched," not just "summarized."

If we replace the memo flow with anything, all nine of these need to come along.

---

## 6. Strategic framing - three candidate strategies

### Strategy A - Memo-first front door

**The idea.** `/company` becomes a single search box and a Generate Memo button. Discovery (the tile grid) moves to a secondary surface or a sidebar. The user types any company name; if it's indexed, we run the existing memo; if it isn't, we fall back to a web-search-grounded memo (Exa or Brave + Gemini, with the same sourcing discipline).

**Data infrastructure required.**
- New: web search adapter (Exa or Brave), with per-source attribution surfaced to the memo as it is to articles today. Already partially exists (`/api/news-search` uses GDELT).
- New: a "scratch entity" persistence layer so a user can revisit `/company/anduril` and see "you generated a memo 2h ago, refresh?" - no `companies` row is needed, just a `company_memos` table keyed on canonical name slug.
- Reuse: `buildMemoSystemPrompt` (rewritten to accept article pool OR web pool inputs), `MemoModal`, role-personalization.
- Reuse: existing `articles` query for indexed companies; new path for un-indexed.

**What it's good at.** Hits the bar. A user typing "Anduril" gets an answer. The product feels like Bloomberg + Perplexity, not like a curated directory.

**What it sacrifices.** Discovery - users who don't know what to search for see less. The "look around at what's hot" appeal of the current tile grid evaporates unless we keep a sidebar. Quality risk on web-search fallback memos vs article-grounded memos (mitigation: prompt rules + provenance labeling).

**Bar fit.** Strong. Probably the most direct path.

### Strategy B - Bloomberg-lite directory

**The idea.** `/company/[id]` becomes a structured page - leadership, financials, recent deals, news, peers, charts - with the memo as one feature among many. Backed by a richer per-company data model: leadership, funding rounds, financials, peer set, customers.

**Data infrastructure required.**
- New: `company_leadership`, `company_funding_rounds`, `company_peers`, `company_financials` tables. Backfill via Wikidata + Crunchbase API + manual seed for top 200 companies.
- New: extraction pipeline for leadership / funding events from articles (Gemini structured output).
- New: peer graph (manual seed for top 200 + co-mention extraction for the long tail).
- Reuse: existing memo as one tab.

**What it's good at.** Deep coverage for the companies it covers. Looks impressive. Caters to professional users who expect Bloomberg-style breadth.

**What it sacrifices.** Bar - coverage stays bounded by the data model's seed set. A long-tail company is just as broken as today, except now there are more empty boxes to apologize for. Effort is enormous (multiple data integrations, ETL, refresh cadences, reconciliation logic). Time-to-value is months.

**Bar fit.** Weak unless paired with web-search fallback. Otherwise it's "better than Google for the Fortune 500" - explicitly NOT the bar.

### Strategy C - Hybrid: memo-led with directory depth

**The idea.** The detail page leads with a memo (the strong artifact). Below it sits a structured-data block that fills in progressively as data exists: leadership block when we have it, peers when we have them, funding history when we have it, otherwise gracefully absent. Search on `/company` accepts any company name; if not indexed, we run a web-search-grounded memo and offer to add it to the user's tracked set.

**Data infrastructure required.**
- New: web search adapter + memo provenance distinction (article-derived vs web-derived facts).
- New: `company_memos` persistence (keyed on canonical name slug + role - invalidated when N new articles arrive).
- New: lightweight company entity table that doesn't depend on the news pipeline (Wikidata seed for ~5000 names + on-demand resolution for the long tail). This is what Agent 3's audit covers from the canonical-entity-layer angle - the implementation is shared.
- Optional later: leadership / funding / peer extraction (Strategy B's work, but progressively).

**What it's good at.** Memo carries the experience day one (the strongest artifact stays front and center). The bar is satisfied via the web-search fallback. Structured depth is additive, not foundational - every box that fills in is a delight, no box is a blocker.

**What it sacrifices.** More complexity than Strategy A; less impressive than Strategy B looks at a screenshot. Requires careful provenance UX so the user knows "this fact came from a Reuters article" vs "this fact came from a web summary."

**Bar fit.** Strong. The only strategy that meets the bar without writing checks the data infrastructure can't cash on day one.

### Recommendation

**Pick C, sequenced as A first.**

Reasoning: Strategy A is contained inside Strategy C's first phase. Build the web-search fallback + memo persistence + canonical entity slug layer (~3 weeks of focused work), ship it as a memo-first reorder of `/company`, then layer in structured-data blocks (leadership first, then funding, then peers) as they become reliable. This gets the bar-meeting outcome shipped fast and protects the memo as the lead artifact while still leaving a runway to "Bloomberg-lite breadth" without committing to Bloomberg-lite cost.

Strategy B as a standalone is wrong because it spends six months building data integrations to solve a problem (long-tail coverage) that one Gemini call solves in 4 seconds. Strategy A as a standalone is acceptable but throws away the structured-page aspiration that already exists in the codebase as dead-code stubs (`company-header.tsx`, `company-tabs.tsx`).

---

## 7. Top 5 highest-leverage improvements (impact-per-effort, ranked)

### #1 - Un-indexed company fallback (web-search-grounded memo)
**What it does.** When the user searches a company that does not exist in `companies`, fall back to: (a) a web search (Exa or Brave) for the last 7-30 days of news; (b) feed the results into the existing memo system prompt with a `MEMO_MODE: web-fallback` flag and provenance labels distinguishing web-derived facts from article-derived ones.
**Why it matters to the bar.** This is the single change that moves Company Intel from "curated directory" to "any company you can think of." Without this, no other improvement matters. With this alone, the bar is met for the search case.
**Rough effort.** 1-2 weeks. New `/api/companies/web-fallback` route, Exa or Brave API integration (similar shape to the existing GDELT call in `/api/news-search/route.ts`), one new prompt branch in `buildMemoSystemPrompt`. Tested against 10 hand-picked un-indexed companies.
**Dependencies.** A canonical-entity-layer slug resolver (Wikidata lookup) - this is in scope for Agent 3's audit. Can ship a v0 without it (slug = lowercase URL-encoded user input) and add Wikidata resolution later.

### #2 - Memo persistence + freshness affordance
**What it does.** Add a `company_memos` table keyed on `(canonical_slug, user_role, generated_at)`. After memo generation, write the result. On next view, render the cached memo immediately with a "Generated 2h ago, refresh?" banner. Auto-stale after 24h or after N new articles arrive (whichever comes first). Persist provenance so the user can see "based on 9 articles, ingested 2-7d ago."
**Why it matters to the bar.** Today every memo is a fresh Gemini call (no cache, no history). This is an obvious "Bloomberg-quality polish" gap. Also unblocks share-the-memo URL: `/company/openai?memo=2026-04-30T14-32` becomes a stable artifact.
**Rough effort.** 1 week. Schema + write hook in `MemoModal.onGenerated` (already a callback today) + read in `CompanyDetailClient`. Pattern is mirrored from `watchlist_briefs`.
**Dependencies.** None. Pure additive.

### #3 - Mobile + signed-in detail UX overhaul
**What it does.** Three concrete fixes: (a) tile grid collapses to 2 columns at <768px and 1 column at <480px, with full names; (b) article-card metadata row stacks vertically on narrow screens, no horizontal overflow; (c) Company Intel becomes a primary mobile nav item (replace one of Deals or Trends in the bottom 5).
**Why it matters to the bar.** Right now the mobile experience visually fails - names truncate to 3 letters, badges clip. A user on phone closes the tab in 5 seconds. The bar implicitly assumes "any device."
**Rough effort.** 2-3 days. Pure CSS / nav config. Zero backend.
**Dependencies.** None.

### #4 - Smarter discovery on `/company` landing
**What it does.** Replace "sort by mention_count" as the only ranking with: (a) personalized rail at top ("Your watchlist + recently viewed"), (b) "Movers in the last 24h" rail (companies with the most new articles since yesterday), (c) "Featured this week" rail (curated by sector breadth × signal density). Industry filters stay. Add tile-level signals: latest deal_type tag, "3 new today" count, source-credibility average.
**Why it matters to the bar.** Discovery as it stands is just `mention_count desc`. A user sees the same six tiles every visit (OpenAI / Anthropic / Meta / etc). There is nothing to "explore." The bar is partially about depth, but a critical part is "I came in for X and discovered Y" - which today the page does not enable.
**Rough effort.** 1-2 weeks. New `/api/companies/discover` endpoint with three buckets, frontend rail layout, lightweight per-tile metadata fetch. Backend: new SQL on `articles` aggregated to per-company in last 24h.
**Dependencies.** Watchlist integration (already exists). Source credibility (already exists).

### #5 - Curated identity expansion + Wikidata fallback
**What it does.** Expand `COMPANY_IDENTITY` from ~30 to ~300 hand-curated names. For everything else, on first detail-page view, fetch a Wikidata summary (industry, founders, founding year, HQ, founded year, brief description) and cache it in a new `company_identity_cache` table. Use this as the "Profile" block on the detail page (above the memo) and as the `ANALYST BACKGROUND` block in the system prompt.
**Why it matters to the bar.** Today, an un-curated company gets no identity context anywhere. With this, every company gets at minimum a Wikidata-derived one-pager. Also strengthens the memo's grounding for low-recognition names - the LOW RECOGNITION COMPANIES carve-out in the prompt becomes data-driven instead of model-judgment-driven.
**Rough effort.** 1 week to wire Wikidata (the path already exists in `backend/wikidata.py` for entity validation; reuse the cache table pattern). 2-3 days more to hand-curate 300 names. Manual curation is the slow part.
**Dependencies.** None. Pattern mirrors existing `wikidata_entity_cache`.

**Honest ranking note.** #1 is the bar-defining move. #2-5 are quality-of-life improvements that compound the value of #1. If forced to choose one, choose #1 - but #1 alone leaves a "the tile grid still sucks, the mobile experience still fails, and the memo still re-runs every time" experience.

---

## 8. Lucas coordination flag

Implementations that touch backend pipeline files (Lucas's lane):

- Improvement #1 (web-search fallback) is fully frontend / new API route. **No `synthesize.py` or `ingest.py` changes.** Pure additive.
- Improvement #2 (memo persistence) is frontend + new table. **No `synthesize.py` or `ingest.py` changes.** Pure additive.
- Improvement #3 (mobile UX) is pure CSS. No backend at all.
- Improvement #4 (discovery rails) is frontend + new read-only API route querying `articles` and `companies`. **No writes to `synthesize.py` or `ingest.py`.**
- Improvement #5 (Wikidata identity expansion) reuses `backend/wikidata.py` pattern but writes to a NEW table (`company_identity_cache`), distinct from the existing `wikidata_entity_cache`. The Wikidata client itself can be invoked from a Node.js path on first access - no Python change required. Optionally, a small extension to the entity-validation flow in `backend/ingest.py` could pre-warm the identity cache as a side effect, but that is optional and would need Lucas review.

**None of these five improvements require a `backend/synthesize.py` change, and none require a `backend/ingest.py` change.**

The one Lucas-touching corner is if we decide to extract structured leadership / funding signals from articles (post-Phase-1, part of Strategy C's second phase) - that would add a Gemini structured-output step in or alongside `backend/ingest.py`. Not in the top 5.

---

## 9. Verification checklist

- [x] `docs/company-intel-current-state.md` written.
- [x] Screenshots saved to `docs/company-intel-screenshots/` (5 images: landing-signed-out, openai-detail-signed-out, memo-signed-out-prompt, mobile-signed-out, mobile-detail-openai). Note: signed-in walk was NOT possible from this audit environment (no live auth context); all signed-in observations are explicitly labeled `[code-derived]`.
- [x] No edits to `backend/synthesize.py`, `backend/ingest.py`, or any code path. Read-only.
- [x] No SQL changes proposed in this document that would be applied; recommendations only.
- [x] No em-dashes anywhere in the document body.

---

## Appendix A - Files referenced

Frontend:
- `src/app/company/page.tsx` (810 LOC) - list page + side-panel detail
- `src/app/company/[id]/page.tsx` - full-route detail server component
- `src/app/company/layout.tsx` - metadata only
- `src/components/company/company-detail-client.tsx` - detail client
- `src/components/company/company-header.tsx` - UNUSED stub with price-aware design
- `src/components/company/company-tabs.tsx` - UNUSED stub with 5-tab structure
- `src/components/memo/MemoModal.tsx` - modal + ink-fade animation
- `src/components/landing/landing-page.tsx:413-444` - marketing "Live Company Intelligence" section that links to /watchlist not /company
- `src/components/shell/sidebar.tsx:70` - Company Intel sidebar entry
- `src/components/shell/mobile-bottom-nav.tsx:36` - Company Intel in MORE_NAV (not primary)
- `src/components/shell/topbar.tsx:66-86` - "Ask Signalera anything..." disabled
- `src/lib/company-intel.ts` (796 LOC) - all pure logic
- `src/lib/article-signal.tsx` - completeness, signal score, source-credibility badges
- `src/proxy.ts:34` - middleware allowlist (/company is public, /company/[id] is not)

API routes:
- `src/app/api/companies/route.ts` - list + search
- `src/app/api/companies/[id]/articles/route.ts` - per-company articles (cache-first)
- `src/app/api/memo/route.ts` (361 LOC) - Gemini memo generation
- `src/app/api/company-search/route.ts` - Clearbit autocomplete (used elsewhere, not on /company)
- `src/app/api/finnhub-search/route.ts` - Finnhub ticker search (not on /company)
- `src/app/api/finnhub-news/route.ts` - Finnhub company news (not on /company)
- `src/app/api/news-search/route.ts` - GDELT search (not on /company)
- `src/app/api/intelligence/route.ts` - RAG chat (not on /company)

Backend (read-only references - not edited):
- `backend/ingest.py:631-721` - companies + company_mentions writes
- `backend/wikidata.py` - Wikidata cache pattern (reuse target)
- `backend/watchlist_sync.py` - watchlist_articles cache writer

Schemas:
- `backend/watchlist_articles_schema.sql`
- `backend/migrations/2026-04-30-companies-junk-name-constraint.sql`
- `backend/migrations/2026-04-29-cleanup-junk-companies.sql`
