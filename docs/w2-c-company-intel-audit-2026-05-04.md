# W2-C: Company Intel current-state audit

## Audit metadata

Author: Agent B (read-only audit). Date: 2026-05-04. Branch: `noah/w2-c-company-intel-audit`. Base commit: `fe327ca04696500fc24d43adb359231a3f40ef3b` (main, "docs: cron-job.org URL audit (2026-05-04) (#183)"). Status: foundation document for the W2-C UI redesign design doc; this PR ships the audit only. No application code touched. This doc mirrors the W2-A audit pattern (PR #173) and the voice of `docs/w2-a-entity-resolution-design.md`.

Scope: every file that contributes to the Company Intel experience as it ships on main today. The detail-page tab shell (`src/components/company/company-tabs.tsx`, `company-header.tsx`) is included for inventory completeness even though the live `src/app/company/[id]/page.tsx` route does not currently mount it; see section 3.

Out of scope (per section 8): UI mockups, design tokens, implementation. Aesthetic judgment is reserved for Noah's manual review (section 7).

## Component inventory

Source roots searched: `src/app/company/`, `src/app/api/companies/`, `src/components/company/`, `src/components/memo/`.

Pages:

- `src/app/company/page.tsx` (1013 lines) - Company Intel directory. Client component. Search, sector filter, three-column grid, side detail panel, both memo modals, web-fallback CTA and result list.
- `src/app/company/[id]/page.tsx` (93 lines) - Per-company detail route. Server component. Slug-to-name decoder; cache-first article fetch via `fetchCompanyArticles`; renders `CompanyDetailClient`.
- `src/app/company/layout.tsx` (9 lines) - Sets the route metadata title.

Components:

- `src/components/company/company-detail-client.tsx` (257 lines) - Client renderer for the dedicated company route. Header, actions row (Add to Watchlist, Generate Memo), grouped article list (Company Events, Sector Context).
- `src/components/company/company-header.tsx` (133 lines) - Standalone header component (name, ticker, sector, price, change, market cap, status badge, bookmark, watchlist, generate-memo). NOT mounted by the live `[id]` route, which uses its own inline header inside `company-detail-client.tsx`.
- `src/components/company/company-tabs.tsx` (62 lines) - Tabbed shell with five tabs (`developments`, `research`, `memos`, `metadata`, `monitoring`). NOT mounted anywhere in the live Company Intel experience.

Memo modal:

- `src/components/memo/MemoModal.tsx` (384 lines) - Shared modal used by `src/app/company/page.tsx` (twice, for indexed and web-fallback paths) and by `src/components/company/company-detail-client.tsx`. Also used outside Company Intel by `deal-flow`, `evening-wrap`, `trends`, `morning-brief`, `watchlist`, `dashboard/story-card`, and `feed/feed-row`.

API routes:

- `src/app/api/companies/route.ts` (89 lines) - GET handler. Reads `companies` table directly. Powers list and search.
- `src/app/api/companies/[id]/articles/route.ts` (92 lines) - GET handler and exported `fetchCompanyArticles` helper. Cache-first read (`watchlist_articles -> articles`) with a `contains("companies", [name])` fallback.
- `src/app/api/companies/web-fallback/route.ts` (125 lines) - POST handler for the web-search-grounded path; auth-gated and feature-flagged on `NEXT_PUBLIC_WEB_FALLBACK_ENABLED`.
- `src/app/api/companies/web-fallback/normalize.ts` (298 lines) - Result-evidence canonical-name derivation (PR #177 plumbing). Helper module, not a route.

Helper library:

- `src/lib/company-intel.ts` - Shared pure logic. Exports `canonicalize`, `parseCompanies`, `timeAgo`, `filterAndClassifyArticles`, `buildMemoContent`, `buildMemoSystemPrompt`, `buildWebFallbackMemoContent`, `buildWebFallbackMemoSystemPrompt`, `CANONICAL`, `COMPANY_IDENTITY`, plus the `CompanyArticle` and `RawArticleRow` interfaces. Imported by both pages and by `[id]/articles/route.ts`.

## Visual baseline per file

### `src/app/company/page.tsx` (1013 lines)

Top-level visual elements: app shell wrapper (mood bar via `useLiveMood`), main column with H2 title plus subtitle (`page.tsx:489-494`), signed-out preview banner (`page.tsx:497-511`), search input or locked placeholder (`page.tsx:513-529`), industry vertical filter row plus optional Match Any/All toggle (`page.tsx:531-594`), three-column company card grid (`page.tsx:717-742`), gold gradient sign-in lock that masks rows past the sixth for signed-out users (`page.tsx:743-769`), web-fallback CTA banner and result list inside the empty-state branch (`page.tsx:611-714`), 420px-wide right-side detail panel (`page.tsx:775-975`) with grouped article cards (Company Events, Sector Context), and two `MemoModal` instances at the bottom of the tree (`page.tsx:978-1003`).

Styling pattern: Tailwind utility classes are the dominant convention. Inline `style={{ ... }}` is used wherever colors come from CSS custom properties (`--gold`, `--gold-muted`, `--parchment`, `--espresso`, `gold-border`, `rgba(201,146,42,0.3)`); examples at `page.tsx:498`, `619`, `746-747`, `750-751`, `763`. Sector chip color comes from `getSectorStyle()` in `src/lib/sector-colors.ts` and is applied via inline `style` at `page.tsx:932-935`. No CSS modules, no styled-components.

Spacing and typography decisions visible in code: H2 sized at `text-[22px]` with `font-extrabold` (`page.tsx:489`); subtitle at `text-[13px]` (`page.tsx:492`); section labels at `text-[9px]` uppercase (`page.tsx:539`, `666`, `836`, `874`, `920`); company card name at `text-[14px]` (`page.tsx:733`); article card title at `text-[13px]` (`page.tsx:693`, `898`, `952`); article body summary at `text-[11px]` (`page.tsx:706`, `908`, `962`); mention badge at `text-[10px]` (`page.tsx:736`); deal-type chip at `text-[9px]` (`page.tsx:882`); tab spacing on filter chips at `px-3 py-1` (`page.tsx:553`); detail panel padding `px-5 py-4` (`page.tsx:778`, `797`); article card padding `p-3` (`page.tsx:680`, `880`, `929`); rounded corners `rounded-xl` for cards and `rounded-lg` for buttons (consistent across the file).

Custom design tokens referenced: `text-espresso`, `text-text-secondary`, `text-text-muted`, `text-text-faint`, `text-text-primary`, `text-gold`, `text-gold-dark`, `text-cream`, `text-signal-up`, `text-signal-dn`, `bg-cream`, `bg-parchment`, `bg-parchment-mid`, `bg-gold`, `bg-gold-muted`, `bg-gold-dark`, `border-border-base`, `border-border-hover`, `border-gold`, `border-gold-border`, `font-display`, `font-sans`, `font-data`, `--duration-base`, `--topbar-height`, `--moodbar-height`. Shadow ring on selected company card uses an arbitrary value: `shadow-[0_2px_8px_rgba(201,146,42,0.12)]` (`page.tsx:728`).

Hints of fast-iteration code: arbitrary Tailwind sizing values dominate. Every type size is a bracketed pixel literal (`text-[8px]` through `text-[22px]`), with `text-[9px]`, `text-[10px]`, `text-[11px]`, `text-[13px]` repeated dozens of times across the file rather than referencing a typography scale token. Three places mix CSS-custom-property colors with Tailwind class colors in the same element (`page.tsx:498`, `619-620`, `750-751`). The signed-out gradient at `page.tsx:746-747` is hand-coded inline. The grid is hardcoded to `grid-cols-3` at every viewport (`page.tsx:598`, `718`); no md/lg responsive variants. The detail panel width is fixed to `w-[420px]` (`page.tsx:776`) with no responsive variant.

### `src/components/memo/MemoModal.tsx` (384 lines)

Top-level visual elements: portal-mounted backdrop (`MemoModal.tsx:237-241`) with `bg-espresso/50`; centered card with `max-w-2xl`, `max-h-[85vh]` (`MemoModal.tsx:244`); header with type label and title plus optional Web-grounded chip (`MemoModal.tsx:247-278`); body with loading spinner, error state, or staggered markdown sections plus optional Sources list (`MemoModal.tsx:281-343`); footer with Copy, Export .md, Close buttons rendered only after memo arrives (`MemoModal.tsx:347-379`).

Styling pattern: Tailwind classes; inline `style` only on the staggered fade animation (`MemoModal.tsx:303-306`) and the Web-grounded chip (`MemoModal.tsx:259-263`). Markdown rendering uses `react-markdown` with custom component overrides (`MemoModal.tsx:12-50`).

Spacing and typography decisions visible in code: type label at `text-[9px]` uppercase (`MemoModal.tsx:249`); title at `text-[20px]` (`MemoModal.tsx:253`); markdown H1 at `text-[17px]`, H2 at `text-[15px]`, H3 at `text-[11px]` uppercase; paragraph and list at `text-[13px]` (`MemoModal.tsx:14-49`); Sources header at `text-[10px]` uppercase (`MemoModal.tsx:319`); source title at `text-[12px]`, metadata at `text-[10px]` (`MemoModal.tsx:324`, `333`); footer button label at `text-[10px]` (`MemoModal.tsx:354`, `366`, `374`); body padding `px-6 py-5` (`MemoModal.tsx:281`); footer padding `px-6 py-3` (`MemoModal.tsx:348`); card border-radius `rounded-2xl` (`MemoModal.tsx:244`).

Custom design tokens referenced: `text-text-primary`, `text-text-secondary`, `text-text-muted`, `text-text-faint`, `text-gold`, `text-espresso`, `text-signal-up`, `text-signal-dn`, `bg-parchment`, `bg-parchment-mid`, `bg-gold-muted`, `border-border-base`, `border-gold/40`, `border-signal-up/30`, `font-display`, `font-sans`, `font-data`. The shadow on the modal card is the Tailwind preset `shadow-2xl` (`MemoModal.tsx:244`).

Hints of fast-iteration code: every text size is a bracketed pixel literal; there is no shared modal typography scale. The fade-in stagger uses a hardcoded 180ms-per-section delay and 400ms duration (`MemoModal.tsx:202`, `MemoModal.tsx:302`); these values are not tokenized. The body has a 16-row vertical center for both the loading spinner and the error block (`MemoModal.tsx:283`, `287`) - not skeleton-shaped. Section parsing for the fade is regex-based on markdown headings (`MemoModal.tsx:54-72`); a body without `#`/`##`/`###` returns a single section.

### `src/components/company/company-detail-client.tsx` (257 lines)

Top-level visual elements: white header bar with company name at `text-[24px] font-extrabold`, optional industry subtitle, and total-articles caption (`company-detail-client.tsx:56-68`); white actions bar with Add to Watchlist and Generate Memo buttons plus a tooltip toast for the no-articles case (`company-detail-client.tsx:71-104`); article list region capped at `max-w-[720px]` (`company-detail-client.tsx:108`) with the Company Events / Sector Context grouping pattern; one `MemoModal` instance at the bottom (`company-detail-client.tsx:247-254`).

Styling pattern: Tailwind classes, with one inline `style` for the sector chip color via `getSectorStyle()` (`company-detail-client.tsx:204`). No CSS modules.

Spacing and typography decisions visible in code: header `px-6 py-5` (`company-detail-client.tsx:56`); actions bar `px-6 py-4` (`company-detail-client.tsx:71`); article region `px-6 py-5` (`company-detail-client.tsx:107`); content column `max-w-[720px]` (`company-detail-client.tsx:57`, `72`, `108`); article cards repeat the same `p-3 rounded-xl` shape and the same `text-[13px]` title and `text-[11px]` summary as `page.tsx:880-911` and `page.tsx:929-963`.

Custom design tokens referenced: same set as `page.tsx` plus `bg-cream`, `bg-white`. No new tokens introduced by this file.

Hints of fast-iteration code: the article-row markup is duplicated almost verbatim with `src/app/company/page.tsx` (`company-detail-client.tsx:140-241` mirrors `page.tsx:870-971`); the only real differences are the credibility lookup signature (`credibilityMap[a.source]` vs `credMap.get(a.source)`) and the wrapping container width. No abstraction yet.

### `src/components/company/company-header.tsx` (133 lines)

Top-level visual elements: header bar with name and ticker on a flex row, sector and status badges below, BookmarkButton plus Add to Watchlist plus Generate Memo on the right; optional price row with formatted change percent and market cap; one `MemoModal` instance.

Styling pattern: Tailwind only; uses the shared `Badge` and `BookmarkButton` from `src/components/ui/`.

Spacing and typography: `px-6 py-5` outer (`company-header.tsx:37`); H1 at `text-[24px] font-extrabold` (`company-header.tsx:42`); ticker at `text-[14px]` (`company-header.tsx:45`); price at `text-[20px]` (`company-header.tsx:106`); change at `text-[13px]` (`company-header.tsx:110`); button text at `text-[11px]` (`company-header.tsx:80`, `93`).

Custom design tokens referenced: same set as the live page; uses `text-signal-up` and `text-signal-dn` for change polarity.

Hints of fast-iteration code: this file is not currently mounted on the live `[id]` route; the live path uses its own inline header inside `company-detail-client.tsx:55-68`. Two divergent headers exist for the same conceptual surface.

### `src/components/company/company-tabs.tsx` (62 lines)

Top-level visual elements: horizontal tab bar with five tab labels ("Live Developments", "Research and Theses", "Deal Memos", "Metadata", "Monitoring"); active tab marked by gold underline; per-tab `children` rendered below.

Styling pattern: Tailwind. Tab divider uses `border-b-2 -mb-px` (`company-tabs.tsx:43`).

Spacing and typography: tab label at `text-[13px]` (`company-tabs.tsx:43`); tab padding `px-4 py-3` (`company-tabs.tsx:43`); content padding `px-6 py-5` (`company-tabs.tsx:57`).

Hints of fast-iteration code: this component is exported but not imported by any live route or page. It is design surface kept around but unwired.

## Known pain points cross-referenced

### Company duplicates

The live list page renders raw `companies.name` from `src/app/api/companies/route.ts:37` (`select("id, name, ticker, sector, mention_count, last_updated, key_themes")`). The route's only filtering is `not("name", "is", null)` plus `not("mention_count", "is", null)` plus a JS noise pass at `route.ts:63-68`. There is no JOIN against `aliases` and no awareness of canonical resolution.

Client-side dedup does exist: `dedupeAndMapApiCompanies` at `src/app/company/page.tsx:68-87` calls `canonicalize()` from `src/lib/company-intel.ts` to map `row.name` to a display name, then collapses rows that canonicalize to the same display name (mention counts summed, sectors merged). The example in the inline comment is "Robinhood" plus "Robinhood Markets Inc" -> one card. This handles a curated subset (`CANONICAL` map in `company-intel.ts`) but does not cover the production-data clusters enumerated in `docs/w2-a-entity-resolution-design.md` section 1: NVIDIA / Nvidia / Nvidia Corp (81 mentions split 3 ways), Meta / Meta Platforms (95 mentions split 2 ways), Google / Google LLC (74 mentions split 2 ways), Tesla (60 mentions split 2 ways), or the Unicode-contamination cases (curly vs straight apostrophes in "Moody's Analytics", "Estee Lauder").

After W2-A ships (per design doc section 9), the directory route gains an alias-keyed lookup ahead of the existing `ilike` fallback, and `companies.name` becomes canonical-only. W2-C UI may want to render the canonical name in the card and surface alias variants on hover or in the detail panel header (e.g., "Also known as: Nvidia Corp, Nvidia"); the data is then available without extra reads.

### Web-fallback routing

The web-fallback CTA fires from the zero-results branch of the list page: `src/app/company/page.tsx:603-714`. The conditions for the CTA banner to appear are at `page.tsx:616`: `webFallbackEnabled && !isSignedOut && search.trim().length >= 2 && webResults.length === 0`. The button calls `handleGenerateWebFallback` (`page.tsx:322-352`), which POSTs to `/api/companies/web-fallback`. Server-side gate at `web-fallback/route.ts:65-70` requires `NEXT_PUBLIC_WEB_FALLBACK_ENABLED === "true"`.

The trigger is "directory search returned zero rows", which today maps to "the user typed something the bare `ilike("name", "%query%")` at `route.ts:48-52` failed to substring-match". Per W2-A design section 9, this is the same root cause as the dedup problem: typing "Perishing Square" misses "Pershing Square" (5 mentions) because the `ilike` is unaware of aliases. After W2-A typo-redirect ships, the alias lookup runs first and routes the user to the canonical company page; web-fallback only fires for entities truly absent from the index. W2-C should not couple to today's "zero results" trigger as if it were stable.

The UI does distinguish web-fallback memos from article-grounded memos, in two places. First, on the result list before generating: a "Web results for {canonicalName}" header at `page.tsx:666` and per-result citation index chips at `page.tsx:682-684` ("[1]", "[2]"). Second, inside the modal: `MemoModal.tsx:256-268` renders a "Web-grounded" chip in the header when `type === "company-web"`, with a `title` attribute that reads "Memo grounded in web search results, not the indexed news pipeline". The chip uses gold-border, gold-muted background, gold text. The cost asymmetry called out in the design doc ($0.005 to $0.035 per web-fallback memo vs. $0 for an article-grounded memo on indexed companies) is not surfaced visually beyond the chip.

The web-fallback memo also renders a Sources list at `MemoModal.tsx:317-341`, gated on `sources && sources.length > 0`. The article-grounded path does not pass `sources`, so the Sources block does not render for it. This is the only visible structural difference inside the modal body between the two paths today.

### Premium-feel gaps

The list below describes specific affordances common in high-end finance UIs that are not present in the current Company Intel code, framed as "code does X today; high-end pattern is Y" without judging X.

- Loading affordance for the list grid is six rectangular `Skeleton` blocks in a 3-column grid (`page.tsx:597-602`). High-end pattern: skeletons that mirror the actual card layout (name slot, mention-badge slot, sector tag slot) and shimmer rather than pulse. The shared `Skeleton` primitive in `src/components/ui/skeleton.tsx` handles either shape; the call site uses the simpler form.

- Loading affordance for the article list is three `h-20` skeleton blocks (`page.tsx:858-861`, `company-detail-client.tsx`). High-end pattern: row skeletons matched to the article-card structure (deal-type chip, source, time, title line, summary lines).

- Loading affordance inside `MemoModal` is a single centered `Loader2` spinner at `MemoModal.tsx:282-285` for the entire body. High-end pattern: skeleton that mirrors the eventual sectioned-memo layout, or a streamed-token render. The current ink-fade animation on `MemoModal.tsx:200-206` only fires after the full memo arrives.

- The search input is a single `<Input>` with a `Search` icon and the placeholder "Search companies..." (`page.tsx:520-528`). High-end pattern: keyboard shortcut hint (`?` or `Cmd K` on the right side), inline recent-searches dropdown, autosuggest from indexed canonical names.

- The mention-count badge reads as `{company.mentions}x` (`page.tsx:737`, `784`). High-end pattern: structured numerical formatting at scale (`1.2K`, `1.2B`), consistent units, optional sparkline of mentions over time.

- Sector colors come from `getSectorStyle()` (a shared map), but the company-card grid does not surface sector at all (`page.tsx:732-738` only shows name and mention count). High-end pattern: subtle sector tag or dot on the card; vertical match logic already computes the sector mapping (`SECTOR_TO_VERTICAL`, `COMPANY_VERTICAL_OVERRIDES`).

- The detail panel has no key-statistic block: no last-mention timestamp, no first-seen date, no sentiment trend chart, no top-articles ranking. The header is name + mention count + close button (`page.tsx:776-794`); the body jumps directly into the Articles list. High-end pattern: header rail of three to five key stats (last seen, first seen, sentiment trend, top theme, related companies).

- Citation styling inside the memo: bracket notation `[1]`, `[2]` is emitted by the model (per `buildWebFallbackMemoSystemPrompt` reference at `page.tsx:362`) but is not currently anchored to the Sources list. The Sources block at `MemoModal.tsx:317-341` is a plain ordered list. High-end pattern: clickable `[1]` superscript that scrolls to or hovers the matching source row; reciprocal hover-highlight from source row back to the in-text citation.

- Source attribution in article cards is a plain `text-[9px]` source name (`page.tsx:886`, `940`, plus equivalents in `company-detail-client.tsx`). High-end pattern: source chip with credibility indicator inline; today the `SourceCredibilityBadge` (`page.tsx:895`, `949`) is rendered in the meta row but not directly attached to the source label.

- Sentiment is fetched (the `articles.sentiment` column is selected at `[id]/articles/route.ts:18` and propagated through `RawArticleRow`), but the live UI does not render a sentiment indicator on either the company card or the article card.

- Empty states use the shared `EmptyState` component with `Building2` icon and a one-sentence description (`page.tsx:603-609`, `862-868`). High-end pattern: empty state with a primary CTA, recent-search context, and a "show all companies" escape hatch.

- The detail panel slides in via state change (no transition); the overlay is not animated. High-end pattern: spring or eased width transition; backdrop dim on the main column.

- Mobile responsiveness is unaddressed in the live layout: `grid-cols-3` is hardcoded with no `md:` or `lg:` variant (`page.tsx:598`, `718`); the side detail panel is fixed at `w-[420px]` (`page.tsx:776`); the detail panel does not collapse to a sheet on narrow viewports.

## API data shape

Fields the list API returns (`src/app/api/companies/route.ts:37`): `id`, `name`, `ticker`, `sector`, `mention_count`, `last_updated`, `key_themes`. The route forwards all of these in `companies` array entries.

Fields the list UI actually renders today (`src/app/company/page.tsx:68-87` and the card markup at `page.tsx:732-738`): `name` (after `canonicalize()`), `mention_count` summed across canonicalized rows, `sector` aggregated into the `sectors[]` array. `id`, `ticker`, `last_updated`, `key_themes` are read by the route but discarded by `dedupeAndMapApiCompanies`.

Fields the article API returns (`src/app/api/companies/[id]/articles/route.ts:18`): `id`, `title`, `source`, `sector`, `sentiment`, `summary`, `content`, `published_at`, `ingested_at`, `url`, `companies`, `primary_company`, `relevance_score`, `deal_type`. The detail panel renders `title`, `source`, `published_at` (via `timeAgo`), `summary`, `url`, `deal_type` (chip), `relevance_score` (via `SignalScore`), `content` and `summary` together (via `getCompleteness`), and `source` (via `SourceCredibilityBadge` lookup against `source_credibility` table). The article API exposes `sentiment` and `ingested_at`; neither is rendered.

Fields the schema HAS but neither route surfaces or the UI renders (from `backend/ingest.py:631-647`, the `upsert_company` write site): `sentiment_trend` (computed and written on insert; read by no caller in `src/`), `key_themes` (selected by the list route, never rendered). `companies.id` is selected but never used by the UI - the list route returns it; the list page never references it; the detail route uses the slug-decoded name as the cache key, not the id, at `src/app/company/[id]/page.tsx:46-53`.

Fields that would inform a richer UI but are not yet exposed by any API in `src/app/api/companies/`:

- `first_seen_at` and `last_seen_at`. Not present on the `companies` row today; W2-A schema (`docs/w2-a-entity-resolution-design.md` section 3) adds `last_seen_at` on the `aliases` table. Useful for "first indexed N days ago" and "last activity N hours ago" stats.
- Top articles for a company, ranked. The `[id]/articles` route returns up to 50 articles ordered by `ingested_at DESC`, not by `relevance_score` and not capped to a top-N. The UI does not show "top three developments" separately; it shows the full list grouped by Company Events vs Sector Context.
- Sector tag joined from articles. The list route returns `companies.sector`, which is a single column on the canonical row. Aggregating sectors from the recent article window (the join the `dedupeAndMapApiCompanies` already attempts client-side via `c.sectors[]`) is currently fed by a single-column read, not by an article-level aggregation.
- Mention history time series. Used to inform a sparkline on the company card or a chart in the detail panel. No API computes this today.
- Alias surface forms. Once W2-A ships, `aliases.surface_form` rows would let the UI render "Also known as: Nvidia, Nvidia Corp" on the canonical detail. No route exposes this today.
- Source-credibility rollup at the company level. Today `source_credibility` is fetched per article source on the client (`page.tsx:447-462`); a precomputed company-level credibility blend is not exposed.

This implies W2-C is mostly a UI sprint, with two API-shaped follow-ups that depend on W2-A (alias surface-forms; canonical sector aggregation) and one that depends on a backend addition (mention-history time series).

## Memo Modal current state

File: `src/components/memo/MemoModal.tsx` (384 lines). Per Step 5 instruction: this section describes the on-main state, not the state that would land if PR #185 (still draft) merged.

Props (`MemoModal.tsx:91-104`):

- `isOpen: boolean`
- `onClose: () => void`
- `title: string`
- `content: string` (the prompt seed, not the rendered memo body)
- `type: MemoType` where `MemoType = "deal" | "thesis" | "brief" | "article" | "company" | "company-web"`
- `systemPrompt?: string`
- `preloadedMemo?: string`
- `onGenerated?: (text: string) => void`
- `sources?: MemoSource[]` where `MemoSource = { url, title, source, publishedAt }`

How `sources` is rendered today: the on-main version DOES render sources. `MemoModal.tsx:317-341` mounts an ordered list under a "Sources" header, gated on `sources && sources.length > 0`. Each entry is an anchor on the title (target=_blank, rel=noopener noreferrer), followed by source name and a 10-character ISO date slice. The hover state is gold underline. This block is wired by `src/app/company/page.tsx:997-1002` (web-fallback path passes `sources`); the article-grounded path (`page.tsx:978-985` and `company-detail-client.tsx:247-254`) does not pass `sources`, so the block does not render there.

Citation anchor behavior: `[n]` markers in the memo prose are rendered as plain text by `react-markdown`. There is no anchor wiring; clicking a `[1]` in the prose does nothing. The Sources list uses `<ol>` (decimal counter) so the visual numbering matches, but it is decorative, not an anchor target. `MemoModal.tsx:317-341` does not assign an `id` to the source `<li>` elements.

Loading state pattern: a centered `Loader2` icon spinning at `text-gold` for the entire body region (`MemoModal.tsx:282-285`). 24px size, `py-16` vertical padding to roughly center within the body. Not a skeleton; not streamed; the modal blocks until the `/api/memo` POST resolves and then the staggered fade-in animation runs (`MemoModal.tsx:191-207`).

Scroll behavior on long memos: the body wrapper at `MemoModal.tsx:281` is `flex-1 overflow-y-auto px-6 py-5`; the modal container uses `max-h-[85vh] flex flex-col overflow-hidden` (`MemoModal.tsx:244`). Header and footer are `flex-shrink-0`, so they remain fixed while the body scrolls. No scroll-to-top on each new section reveal; no jump-to-section nav.

Source list density on screen: ordered list at `pl-5 space-y-1.5` (`MemoModal.tsx:322`); each `<li>` is `text-[12px] leading-snug`. Title is the anchor; metadata (source name, optional date) is appended inline at `text-[10px] text-text-faint`. With six sources at the typical web-fallback fan-out, the list takes roughly 110-130 px of vertical space below the memo body and inside the same scroll container.

Mobile responsiveness concerns visible in the markup: the modal is fixed at `max-w-2xl` (`MemoModal.tsx:244`) which is roughly 672px; on viewports below ~720px the `p-6` outer padding (`MemoModal.tsx:239`) plus the modal width pushes the modal edge-to-edge. The `max-h-[85vh]` cap holds on mobile. Header gap between type-label, title, and Web-grounded chip uses `gap-2` and a single flex row (`MemoModal.tsx:252-269`); on a narrow viewport the Web-grounded chip can wrap below the title or push the close button off the row depending on title length (no `flex-wrap` on the parent). The footer button row has three buttons with `gap-2` (`MemoModal.tsx:348`); on a narrow viewport these may wrap.

## Manual review required

This audit ends with the affordance inventory above. Aesthetic judgment on which gaps are "fix in W2-C" vs. "fine for now" is not in this PR. Noah does the following before W2-C design doc is written:

1. Open Company Intel in dev (and prod, for the indexed-canonical case), and walk through the full flow: directory load, search match, search miss into web-fallback CTA, web-fallback result list, web-fallback memo, detail panel for an indexed company, detail-page route at `src/app/company/[id]`, and the `MemoModal` on each path.
2. Capture screenshots at each step. The duplicate-cluster view (search "Nvidia" today; observe NVIDIA, Nvidia, Nvidia Corp surfacing as one collapsed row by `dedupeAndMapApiCompanies` for some clusters and as separate rows for others depending on whether the cluster is in `CANONICAL`) is a specific case worth capturing pre-W2-A and post-W2-A for comparison.
3. Walk each pain-point category from section 4 and decide: in W2-C scope (UI redesign delivers it), in a separate workstream (e.g., mention-history time series wants a backend job; alias surface-form hover wants W2-A first), or accepted as-is for V1 (e.g., mobile responsiveness may be deferred).
4. Approve the W2-C scope before the W2-C design doc is written. The design doc names the visual system, the redesigned page states, and the API extensions (if any); this audit is the input to that scoping conversation, not a substitute for it.

## Out of scope

This document is a foundation for the W2-C design doc, not the design doc. Explicitly out of scope here:

- UI mockups, wireframes, or visual proposals.
- Design tokens (typography scale, color ramp, spacing scale, shadow tokens) - existing tokens are catalogued where they appear in code; no proposals for new tokens are made.
- Implementation. Not a single application file is modified by this PR.
- Subjective aesthetic judgments. Words like "polished", "premium", "amateur", or any equivalent value-laden description of the existing UI do not appear in this document. Section 4 frames each affordance gap as "code does X today; high-end pattern is Y" so the manual review (section 7) is the venue for the judgment call.
- W2-A coupling decisions. The audit references the W2-A design doc where the dedup and typo-redirect work intersects with the UI; it does not propose changes to W2-A scope or sequencing.
- PR #185 (in-flight Sources rendering changes). Section 6 describes on-main state only. If PR #185 lands before W2-C design begins, that delta is for the W2-C design doc to absorb, not this audit.
