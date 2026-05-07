# W2-C Phase 1 Detail Page -- Smoke Test Recipe

Status: pre-ship draft. Walk-through after each sub-PR ships and before PR #197 merge to main. Date: 2026-05-07

## Conventions

- ID format: `<CategoryLetter><Number>` (e.g. A1, B3, T11). Letters A-T track the 20 functional surfaces below.
- Priorities: `P0` (must pass before sub-PR can merge), `P1` (must pass before PR #197 to main), `P2` (nice-to-have, file follow-up if failing), `KNOWN-FAIL` (intentionally accepted failure with a note explaining why), `KNOWN-DEFERRED` (gated on another sub-PR or seed work landing first; track separately).
- Slug pattern: detail pages live at `/company/<slug>` where slug is the lower-cased canonical name with spaces and punctuation replaced by `-`. Class-share entities normalize to the primary share class (Berkshire -> `/company/berkshire`).
- Auth assumption: tester is signed in as a real user with at least one watchlist row. Where a test references "anon" we explicitly call it out.
- Selector hint convention: prefer `data-testid` where present, fall back to `getByRole` + accessible name, then `getByText` for content assertions. Existing specs in `e2e/*.spec.ts` use a mix; new selectors should be added with `data-testid` when ambiguity exists.

## A. Header + Alias Ribbon (Frame 3)

CompanyHeader (44x44 logo box, name, ticker chip, exchange/sector subtitle, SentimentPill), action buttons (+ Watchlist, Export, Generate Memo), CANONICAL alias ribbon below header.

| ID | Test | Expected Result | Page/Element | Playwright Selector Hint | Priority |
|----|------|-----------------|--------------|--------------------------|----------|
| A1 | Logo box renders at 44x44 | Square element 44px on each side, contains domain favicon or initials fallback | `/company/nvidia` header | `[data-testid="company-logo"]` | P0 |
| A2 | Company name renders as h1 | Text "NVIDIA Corporation" or canonical name visible, font-family Playfair Display | header h1 | `page.getByRole('heading', { level: 1 })` | P0 |
| A3 | Ticker chip renders | "NVDA" inside chip with monospace font, exchange "NASDAQ" suffix or subtitle | header ticker | `[data-testid="ticker-chip"]` | P0 |
| A4 | Sector subtitle renders | Sector name from companies.sector visible, e.g. "Technology" | header subtitle | `[data-testid="company-subtitle"]` | P1 |
| A5 | SentimentPill renders | Pill with bullish/neutral/bearish color and label, value derived from articles 30d window | header right | `[data-testid="sentiment-pill"]` | P0 |
| A6 | + Watchlist button visible | Button labelled "+ Watchlist" or shows tracked state when already on watchlist | header actions | `page.getByRole('button', { name: /watchlist/i })` | P0 |
| A7 | Export button visible | Button labelled "Export" triggers menu or download | header actions | `page.getByRole('button', { name: 'Export' })` | P1 |
| A8 | Generate Memo button visible | Button labelled "Generate Memo" wired to /api/memo | header actions | `page.getByRole('button', { name: /generate memo/i })` | P0 |
| A9 | CANONICAL alias ribbon below header | Ribbon row with "CANONICAL" tag and chips for top alias surface forms | below header | `[data-testid="alias-ribbon"]` | P1 |
| A10 | Alias chips show mention counts | Each alias chip has count text e.g. "Nvidia x 24" | alias ribbon | `[data-testid="alias-chip"]` | P1 |
| A11 | Header sticks on scroll | Header remains visible at top of viewport when content scrolls past | scroll container | n/a (visual) | P2 |
| A12 | Header renders for null-ticker entity | X (Twitter) `/company/x` header shows name + sector but no ticker chip | `/company/x` | `page.getByText('X', { exact: true })` | P1 |

## B. KPI Strip (Frame 3)

6 KPI cards (Last, Market cap, Mentions-30d, Sentiment, Articles-today, Sources). Delta arrow + color. Empty-state for private companies (Stripe). Empty-state when /api/company-kpis returns 404. Crumb-auth recovery (Phase 4 finding).

| ID | Test | Expected Result | Page/Element | Playwright Selector Hint | Priority |
|----|------|-----------------|--------------|--------------------------|----------|
| B1 | 6 KPI cards render in strip | All six titles present in order: Last, Market cap, Mentions 30d, Sentiment, Articles today, Sources | KPI strip | `[data-testid="kpi-strip"] >> [data-testid="kpi-card"]` count=6 | P0 |
| B2 | Last price delta arrow + color | Up arrow + green for positive, down arrow + red for negative | KPI Last | `[data-testid="kpi-card"]:has-text("Last") [data-testid="delta"]` | P0 |
| B3 | Market cap formatted | Formatted as $1.2T / $850B / $4.2M with appropriate suffix | KPI Market cap | `getByText(/\$\d+(\.\d+)?[KMBT]/)` | P1 |
| B4 | Mentions 30d numeric | Integer, sourced from articles count where ingested_at >= now() - 30d | KPI Mentions | `[data-testid="kpi-card"]:has-text("Mentions")` | P0 |
| B5 | Sentiment KPI matches header pill | Same bullish/neutral/bearish label as A5 SentimentPill | KPI Sentiment | `[data-testid="kpi-card"]:has-text("Sentiment")` | P1 |
| B6 | Articles today integer | Integer >= 0 from articles where DATE(ingested_at) = CURRENT_DATE | KPI Articles today | `[data-testid="kpi-card"]:has-text("Articles today")` | P1 |
| B7 | Sources count integer | Distinct count from articles.source for last 30d | KPI Sources | `[data-testid="kpi-card"]:has-text("Sources")` | P1 |
| B8 | Empty state for Stripe (private) | "Last" and "Market cap" cells render "--" or "Private" | `/company/stripe` | `[data-testid="kpi-strip"]` | P0 |
| B9 | /api/company-kpis 404 empty state | All 6 cards render "--" placeholders, no error toast | mock 404 | network mock | P1 |
| B10 | Crumb-auth recovery | Yahoo crumb auth refresh succeeds; second load reflects new price not "--" | reload after 401 | network observe | P1 |
| B11 | KPI strip horizontal scroll on narrow | At < 768px width strip scrolls horizontally without clipping | mobile viewport | n/a | P1 |

## C. Function Tabs (Frame 3, F1-F9)

Default F1 Brief. Alt+1..9 keyboard jumps. `[`/`]` cycle. URL `?tab=` persistence. Bail when input/textarea/contenteditable focused. F6-F9 render ComingSoonTab with substrate Step labels.

| ID | Test | Expected Result | Page/Element | Playwright Selector Hint | Priority |
|----|------|-----------------|--------------|--------------------------|----------|
| C1 | Default tab is F1 Brief | On first load Brief tab is active, panel has aria-selected=true | tabs strip | `[role="tab"][aria-selected="true"]` matches "Brief" | P0 |
| C2 | Alt+1 jumps to F1 | After Alt+1 the Brief tab is active | keyboard | `page.keyboard.press('Alt+1')` | P0 |
| C3 | Alt+2 jumps to F2 Articles | Articles tab becomes aria-selected=true | keyboard | `Alt+2` | P0 |
| C4 | Alt+9 jumps to F9 ComingSoon | F9 panel renders ComingSoonTab content | keyboard | `Alt+9` | P1 |
| C5 | `[` cycles to previous tab | From F3 Themes pressing `[` activates F2 Articles | keyboard | `page.keyboard.press('[')` | P1 |
| C6 | `]` cycles to next tab | From F3 Themes pressing `]` activates F4 Trend | keyboard | `]` | P1 |
| C7 | URL ?tab= persists across reload | After clicking Trend, URL has ?tab=trend; reload preserves Trend active | URL | `expect(page).toHaveURL(/tab=trend/)` | P0 |
| C8 | Alt+number bails when input focused | With cursor inside the watchlist add input, Alt+3 does NOT change tab | keyboard + input focus | `inputRef.focus(); Alt+3` | P0 |
| C9 | `[`/`]` bails when input focused | Same as C8 for bracket keys | keyboard + input focus | n/a | P0 |
| C10 | F6 renders ComingSoonTab | Body shows substrate "Step" label and disabled state | F6 panel | `getByText(/coming soon/i)` | P1 |
| C11 | F7 ComingSoon shows substrate Step label | "Step 5 -- Output capture" or equivalent label visible | F7 panel | `getByText(/Step \d/)` | P1 |
| C12 | F8 ComingSoon | Same pattern, distinct Step label | F8 panel | n/a | P2 |
| C13 | F9 ComingSoon | Same pattern, distinct Step label | F9 panel | n/a | P2 |
| C14 | Tab focus ring uses focus-visible | Keyboard tab to a tab shows ring; mouse click does not | a11y | visual | P1 |

## D. Brief Tab (F1)

Cached memo display. Empty-state with Generate Memo CTA. Structured TLDR + LEAD + CONTEXT + WHAT TO WATCH sections. Inline `[n]` citations via CitedText regex `/(\[\d+\])/g`. Citation hover/click to Sources.

| ID | Test | Expected Result | Page/Element | Playwright Selector Hint | Priority |
|----|------|-----------------|--------------|--------------------------|----------|
| D1 | Cached memo renders TLDR section | Heading "TLDR" visible with at least one paragraph below | Brief panel | `getByRole('heading', { name: 'TLDR' })` | P0 |
| D2 | LEAD section renders | Heading "LEAD" visible with content | Brief panel | `getByRole('heading', { name: 'LEAD' })` | P0 |
| D3 | CONTEXT section renders | Heading "CONTEXT" visible with content | Brief panel | `getByRole('heading', { name: 'CONTEXT' })` | P0 |
| D4 | WHAT TO WATCH section renders | Heading "WHAT TO WATCH" visible with bullet list | Brief panel | `getByRole('heading', { name: /what to watch/i })` | P0 |
| D5 | Inline [n] citations linkified | At least one `[1]` token rendered as anchor with href targeting source row | Brief body | `getByRole('link', { name: '[1]' })` | P0 |
| D6 | Citation click scrolls to source | Click on `[1]` anchors to Sources tab footer source row 1 | Brief -> Sources | `getByRole('link', { name: '[1]' }).click()` | P1 |
| D7 | Citation hover preview | Tooltip or popover shows source domain + headline | Brief body | `getByRole('link', { name: '[1]' }).hover()` | P2 |
| D8 | Empty-state Generate Memo CTA | When no cached memo, CTA labelled "Generate Memo" appears with explanation | empty Brief | `getByRole('button', { name: /generate memo/i })` | P0 |
| D9 | Citation regex `/(\[\d+\])/g` matches multi-digit | `[12]` and `[1]` both linkify | Brief body | content assertion | P1 |
| D10 | Brief tab text uses serif body font | Computed font-family includes "Playfair Display" or sans body per design tokens | a11y | visual | P2 |

## E. Articles Tab (F2)

Article rows (deal_type chip, headline, source, signal score, sentiment pill, age). Sort by relevance (default), toggleable. Empty-state when no recent coverage. Filter pills (All / Events / Bullish).

| ID | Test | Expected Result | Page/Element | Playwright Selector Hint | Priority |
|----|------|-----------------|--------------|--------------------------|----------|
| E1 | Article rows render with deal_type chip | Each row has deal_type chip ("Earnings", "M&A", etc.) when present | Articles list | `[data-testid="article-row"]` | P0 |
| E2 | Headline renders as link | Each row headline is a clickable anchor opening article URL in new tab | Articles list | `getByRole('link')` per row | P0 |
| E3 | Source domain visible | Source name (e.g. "Reuters") visible in row meta | Articles list | `[data-testid="article-source"]` | P0 |
| E4 | Signal score visible | Numeric score 0-100 visible per row | Articles list | `[data-testid="signal-score"]` | P1 |
| E5 | Sentiment pill per row | Mini sentiment pill (bullish/neutral/bearish) per row | Articles list | `[data-testid="row-sentiment"]` | P1 |
| E6 | Relative age string | Age formatted "2h ago" / "3d ago" | Articles list | `getByText(/\d+[hdm] ago/)` | P1 |
| E7 | Default sort is relevance | First row has highest signal score among first 10 rows | Articles list | observation | P1 |
| E8 | Toggle sort to recency | Click "Sort: Recent" then first row is most recent ingested_at | sort control | `getByRole('button', { name: /sort/i })` | P1 |
| E9 | Filter pill "All" default | "All" pill active on load | filter pills | `[data-testid="filter-pill"]:has-text("All")` | P1 |
| E10 | Filter pill "Events" | Click "Events"; only rows with deal_type set remain | filter pills | n/a | P1 |
| E11 | Filter pill "Bullish" | Only rows with bullish sentiment remain | filter pills | n/a | P1 |
| E12 | Empty-state when no recent coverage | "No recent coverage" message when 0 articles | low-coverage entity | `getByText(/no recent coverage/i)` | P0 |

## F. Themes Tab (F3) + Themes Card right rail

Top 6 themes, weight bars, sentiment chips, count display. Empty-state when key_themes NULL.

| ID | Test | Expected Result | Page/Element | Playwright Selector Hint | Priority |
|----|------|-----------------|--------------|--------------------------|----------|
| F1 | 6 theme rows render | Themes tab body has up to 6 rows with theme labels | F3 panel | `[data-testid="theme-row"]` | P0 |
| F2 | Weight bar reflects relative weight | Bar width corresponds to weight value, max=100% | F3 panel | `[data-testid="theme-weight"]` | P1 |
| F3 | Sentiment chip per theme | Bullish/neutral/bearish chip beside each theme | F3 panel | `[data-testid="theme-sentiment"]` | P1 |
| F4 | Article count per theme | Numeric count visible | F3 panel | `[data-testid="theme-count"]` | P1 |
| F5 | Empty-state when key_themes NULL | "No themes detected yet" message renders | low-coverage entity | `getByText(/no themes/i)` | P1 |
| F6 | Themes Card right rail mirrors tab | Right-rail card lists same top 3 themes as Themes tab top 3 | right rail | `[data-testid="themes-card"]` | P1 |
| F7 | Right rail click navigates to F3 | Clicking a right-rail theme activates F3 Themes tab | right rail | n/a | P2 |

## G. Trend Tab (F4) + Trend Card right rail

8-day MiniBars, 8-day Sparkline, SentimentHeat 8 cells, up/down delta percentages. CompanyStockChart from PR #196 inside TrendTab.

| ID | Test | Expected Result | Page/Element | Playwright Selector Hint | Priority |
|----|------|-----------------|--------------|--------------------------|----------|
| G1 | MiniBars renders 8 bars | SVG / div with exactly 8 bar elements representing last 8 days | F4 panel | `[data-testid="mini-bars"] >> rect` count=8 | P0 |
| G2 | Sparkline renders 8 points | SVG path with 8 vertices for mention or sentiment trend | F4 panel | `[data-testid="sparkline"]` | P0 |
| G3 | SentimentHeat 8 cells | Heat strip with 8 colored cells | F4 panel | `[data-testid="sentiment-heat"] >> [data-testid="heat-cell"]` count=8 | P0 |
| G4 | Up delta % renders for positive shift | "+12%" with green color when current > previous window | F4 panel | `getByText(/\+\d+%/)` | P1 |
| G5 | Down delta % for negative shift | "-7%" with red color | F4 panel | `getByText(/-\d+%/)` | P1 |
| G6 | CompanyStockChart embedded in TrendTab | Chart canvas / svg renders price line for last 30d | F4 panel | `[data-testid="company-stock-chart"]` | P0 |
| G7 | Stock chart for BRK.B uses hyphen substitution | Network request hits `BRK-B` not `BRK.B` for Yahoo chart endpoint | network | request capture | P1 |
| G8 | Trend Card right rail mirrors | Right rail compact MiniBars + delta visible | right rail | `[data-testid="trend-card"]` | P1 |

## H. Sources Tab (F5) + Sources Strip footer

Numbered citations, source domain, tier badge (PRIMARY / TIER-1) hard-coded source-name -> tier map (Phase 2 finding). Citation anchor click scrolls to source row.

| ID | Test | Expected Result | Page/Element | Playwright Selector Hint | Priority |
|----|------|-----------------|--------------|--------------------------|----------|
| H1 | Numbered citation rows | Each row prefixed with [1], [2], [3]... | F5 panel | `[data-testid="source-row"]` | P0 |
| H2 | Source domain visible | Domain text e.g. "reuters.com" visible per row | F5 panel | `[data-testid="source-domain"]` | P0 |
| H3 | Tier badge PRIMARY for primary sources | Source = "Reuters" (or other primary) shows "PRIMARY" badge | F5 panel | `[data-testid="tier-badge"]:has-text("PRIMARY")` | P1 |
| H4 | Tier badge TIER-1 for tier-1 sources | Bloomberg / WSJ / FT show "TIER-1" badge | F5 panel | `getByText('TIER-1')` | P1 |
| H5 | Sources Strip footer renders | Footer strip lists same numbered citations as F5 in compact form | footer | `[data-testid="sources-strip"]` | P1 |
| H6 | Citation anchor click scrolls source row into view | Click `[3]` anchor; row [3] is in viewport with focus ring | Brief -> F5 | observation | P1 |
| H7 | Hard-coded source-tier map covers WSJ/Bloomberg/Reuters/FT | Each renders correct tier even when articles.source has no tier metadata | F5 panel | content | P1 |

## I. Empty State (Frame 7 -- Stripe pattern)

"Last indexed -- X days ago" derived from MAX(articles.ingested_at). "Sources checked -- N". "Watchlist -- N users" COUNT DISTINCT. "Notify me when indexed" CTA gated, disabled-with-tooltip. "Generate from web" CTA wires to /api/companies/web-fallback.

| ID | Test | Expected Result | Page/Element | Playwright Selector Hint | Priority |
|----|------|-----------------|--------------|--------------------------|----------|
| I1 | Empty state renders for Stripe | Brief panel shows "Last indexed -- N days ago" pattern | `/company/stripe` | `getByText(/last indexed/i)` | P0 |
| I2 | Last indexed value matches MAX(articles.ingested_at) | Days computed from current date minus max ingested_at | empty Brief | content + DB compare | P1 |
| I3 | "Sources checked -- N" line | Numeric N matches distinct source count for entity | empty Brief | `getByText(/sources checked/i)` | P1 |
| I4 | "Watchlist -- N users" line | N = COUNT(DISTINCT user_id) from watchlist where identifier matches | empty Brief | `getByText(/watchlist .* users/i)` | P1 |
| I5 | "Notify me when indexed" CTA gated | Button disabled with tooltip "Sign in to enable notifications" for anon, enabled for signed-in | empty Brief | `getByRole('button', { name: /notify me/i })` | P1 |
| I6 | "Generate from web" CTA wires to web-fallback | Click triggers POST to /api/companies/web-fallback | empty Brief | network observe | P0 |
| I7 | Web-fallback success transitions to Frame 6 | After successful web-fallback response Brief shows Frame 6 web-sourced layout | empty Brief | observation | P1 |

## J. Web-Fallback (Frame 6 -- Pershing typo)

ALIAS-RESOLVED banner. WEB-SOURCED chip. Purple `[w1]`-`[w5]` citations. "Auto-upgrades to article-grounded" copy. "Estimated next index: Xh" from cron-job.org schedule (6am + 8pm PT).

| ID | Test | Expected Result | Page/Element | Playwright Selector Hint | Priority |
|----|------|-----------------|--------------|--------------------------|----------|
| J1 | Typo "Perishing Square" alias resolves | Navigation to `/company/perishing-square` redirects to canonical Pershing slug | route | `expect(page).toHaveURL(/pershing/)` | KNOWN-DEFERRED |
| J2 | ALIAS-RESOLVED banner renders | Banner visible at top of page when alias used | Frame 6 | `[data-testid="alias-resolved-banner"]` | KNOWN-DEFERRED |
| J3 | WEB-SOURCED chip on memo | Purple chip labelled "WEB-SOURCED" visible on Brief when no article-grounded memo | Brief | `[data-testid="web-sourced-chip"]` | KNOWN-DEFERRED |
| J4 | Citations render purple | `[w1]`-`[w5]` tokens rendered with purple text class | Brief | `[data-testid="web-citation"]` | KNOWN-DEFERRED |
| J5 | Citation regex matches `[w1]` form | CitedText regex extended to handle `[w\d]+` | Brief | content | KNOWN-DEFERRED |
| J6 | "Auto-upgrades to article-grounded" copy | Footnote / banner text present | Frame 6 | `getByText(/auto-upgrades/i)` | KNOWN-DEFERRED |
| J7 | "Estimated next index: Xh" copy | Hours computed from next cron tick (6am or 8pm PT) | Frame 6 | content | KNOWN-DEFERRED |
| J8 | cron-job.org schedule reflected | Next-index estimate matches 6am + 8pm PT cadence within 1h | Frame 6 | content + clock | KNOWN-DEFERRED |
| J9 | Sources strip lists 5 web sources | 5 numbered web sources `[w1]`-`[w5]` in footer | Sources | `[data-testid="sources-strip"]` | KNOWN-DEFERRED |

Note: J1-J9 marked KNOWN-DEFERRED -- alias seed required ("Perishing Square" typo with "Perishing" spelling absent from aliases table; only canonical "Pershing Square" forms exist), file as W2-D follow-up.

## K. Loading State (Frame 8)

Skeleton bars on Brief during /api/memo. "Generating" chip. Pipeline-trace right rail (V1.5 only).

| ID | Test | Expected Result | Page/Element | Playwright Selector Hint | Priority |
|----|------|-----------------|--------------|--------------------------|----------|
| K1 | Skeleton bars render during /api/memo pending | Brief panel shows shimmer skeleton lines while POST /api/memo is in flight | Brief loading | `[data-testid="brief-skeleton"]` | P0 |
| K2 | "Generating" chip on Brief | Chip with text "Generating" visible while pending | Brief loading | `getByText('Generating')` | P0 |
| K3 | Skeleton hides when memo arrives | Skeleton disappears within 200ms of /api/memo 200 response | Brief loading -> ready | observation | P1 |
| K4 | Pipeline-trace right rail (V1.5 only) | Right rail shows step-by-step pipeline trace; FEATURE FLAG gates this | right rail | `[data-testid="pipeline-trace"]` | P2 |
| K5 | Skeleton shows for slow networks | At simulated 4G throttle skeleton remains visible until response | network throttle | observation | P2 |

## L. Substrate Hooks

recordOutput() called on /api/memo success at lines 334 + 379. `outputs` table receives row with `output_type='memo'`, `source_table='companies'`. Detail page render does NOT call recordOutput. Pattern A (Next.js after()) vs Pattern B (synchronous output_id) timing.

| ID | Test | Expected Result | Page/Element | Playwright Selector Hint | Priority |
|----|------|-----------------|--------------|--------------------------|----------|
| L1 | recordOutput called on /api/memo success | DB outputs table has new row with output_type='memo' after Generate Memo click | DB observe | SQL count delta | P0 |
| L2 | source_table = 'companies' on output row | New outputs row has source_table='companies' | DB observe | SQL | P0 |
| L3 | output_type = 'memo' | Same row has output_type='memo' | DB observe | SQL | P0 |
| L4 | Detail page render does NOT call recordOutput | Pure GET render of `/company/nvidia` produces zero new outputs rows | DB observe | SQL count diff = 0 | P0 |
| L5 | Memo cache hit produces no duplicate output | Generate Memo when cache fresh -> outputs count unchanged | DB observe | SQL | P1 |
| L6 | Pattern A timing (Next.js after()) | Response returns BEFORE outputs row inserted; row appears within 2s after response | DB poll after response | timing observe | P1 |
| L7 | Pattern B timing (synchronous output_id in response) | Response body includes output_id; outputs row exists at response time | response + DB | content | P1 |
| L8 | recordOutput line 334 reachable | Memo success path hits line 334 (verify via instrumented log or coverage) | server log | log inspect | P2 |
| L9 | recordOutput line 379 reachable | Alternate memo success path hits line 379 | server log | log inspect | P2 |

Note: pick L6 OR L7 to assert against the current implementation in src/app/api/memo/route.ts. After PR-D2 (recordOutput integration) merges, exactly one of L6 (Pattern A: Next.js after()) or L7 (Pattern B: synchronous output_id in response) is the canonical timing. Mark the rejected pattern as test.fixme(true, 'rejected timing pattern, retained for design history') so the recipe does not flap.

## M. Cross-Tab / Page Regression

Existing /company directory loads. CompanyIntelMemoModal opens correctly when wired. Watchlist toggle on directory updates sidebar count. Mood bar on all pages. Skip link from PR #213/N1. Period -> hyphen Yahoo substitution intact for BRK.B chart.

| ID | Test | Expected Result | Page/Element | Playwright Selector Hint | Priority |
|----|------|-----------------|--------------|--------------------------|----------|
| M1 | /company directory loads | List of companies renders without 500 | `/company` | `[data-testid="company-grid"]` | P0 |
| M2 | CompanyIntelMemoModal opens | Click "View memo" on directory card opens modal with memo content | `/company` | `[data-testid="memo-modal"]` | P1 |
| M3 | Watchlist toggle on directory updates sidebar count | Adding/removing from directory card updates sidebar watchlist count | `/company` -> sidebar | `[data-testid="watchlist-count"]` | P1 |
| M4 | Mood bar renders on /company | Mood bar visible at top of page | `/company` | `[data-testid="mood-bar"]` | P1 |
| M5 | Mood bar renders on detail page | Mood bar visible on `/company/nvidia` | detail | `[data-testid="mood-bar"]` | P1 |
| M6 | Mood bar renders on /trends | Mood bar visible on /trends | `/trends` | n/a | P2 |
| M7 | Skip link present (PR #213/N1) | First Tab focuses skip-to-main link | keyboard | `page.keyboard.press('Tab')` then `getByRole('link', { name: /skip to main/i })` | P1 |
| M8 | BRK.B Yahoo chart uses BRK-B | Network request to Yahoo chart endpoint uses `BRK-B` symbol | `/company/berkshire` | request capture | P0 |
| M9 | No regressions on /trends or /thesis | Pages still load and core selectors still work | `/trends`, `/thesis` | smoke run existing specs | P1 |

## N. Keyboard Accessibility

Skip-to-main on Tab+focus (PR #213/N1). focus-visible (not focus). Alt+number bails on input focus. `[`/`]` bails on input focus. Tab order: skip link -> sidebar -> header actions -> tab strip -> tab content -> right rail -> footer.

| ID | Test | Expected Result | Page/Element | Playwright Selector Hint | Priority |
|----|------|-----------------|--------------|--------------------------|----------|
| N1 | First Tab focuses skip link | Tab from page load focuses skip-to-main element | keyboard | `Tab` | P0 |
| N2 | Skip link Enter scrolls main into view | Pressing Enter on skip link moves focus to main element | keyboard | observation | P1 |
| N3 | Tab order matches design | Sequence: skip link -> sidebar -> header actions -> tab strip -> active tab content -> right rail -> footer | keyboard | manual run | P1 |
| N4 | focus-visible (not :focus) ring | Mouse click does not show focus ring; keyboard tab does | a11y | visual | P1 |
| N5 | Alt+number bails on input focus | C8 covered; verify across all 9 keys | keyboard | n/a | P0 |
| N6 | Bracket keys bail on input focus | C9 covered; verify both `[` and `]` | keyboard | n/a | P0 |
| N7 | Bracket keys bail on contenteditable | Memo edit area (if present) blocks `[`/`]` shortcuts | keyboard | n/a | P1 |
| N8 | Esc closes alias ribbon expansion | If alias chips open a flyout, Esc closes it | keyboard | `Escape` | P2 |

## O. Mobile (Frame 4)

380x800 viewport. Sidebar collapses below 768px. Horizontal-scroll tab bar. Right rail stacks below main. Tap targets >= 44x44 (KNOWN-FAIL until W2-D for search input height 36 + watchlist star 21x21).

| ID | Test | Expected Result | Page/Element | Playwright Selector Hint | Priority |
|----|------|-----------------|--------------|--------------------------|----------|
| O1 | Page loads at 380x800 viewport | No horizontal overflow on root document | mobile viewport | `page.setViewportSize({ width: 380, height: 800 })` | P0 |
| O2 | Sidebar collapses below 768px | Sidebar hidden or in drawer mode at width < 768 | mobile | `[data-testid="sidebar"]` not visible | P0 |
| O3 | Hamburger toggle opens drawer | Tap hamburger reveals navigation drawer | mobile | `getByRole('button', { name: /menu/i })` | P1 |
| O4 | Tab bar horizontally scrollable | Tab strip overflows-x with momentum scroll | mobile | scroll observation | P1 |
| O5 | Right rail stacks below main | Themes/Trend cards render below main on mobile, full width | mobile | layout observation | P0 |
| O6 | Tap target watchlist star 21x21 | KNOWN-FAIL: star measures 21x21, must be >= 44x44 by W2-D | mobile | bounding box | KNOWN-FAIL |
| O7 | Tap target search input height 36 | KNOWN-FAIL: input height 36, must be >= 44 by W2-D | mobile | bounding box | KNOWN-FAIL |
| O8 | All other tap targets >= 44x44 | Buttons in header, tabs, filter pills all >= 44x44 | mobile | bounding box | P1 |
| O9 | KPI strip horizontal scroll on mobile | Strip overflows-x with snap-scroll on mobile width | mobile | observation | P1 |

## P. Performance Budgets

TTI < 2s on 4G throttle. /api/company-kpis p95 < 800ms. Tab switch < 100ms. /api/stock-chart p95 < 500ms. Bundle delta < 50KB gzip per sub-PR.

| ID | Test | Expected Result | Page/Element | Playwright Selector Hint | Priority |
|----|------|-----------------|--------------|--------------------------|----------|
| P1 | TTI < 2s on 4G throttle | Time to interactive under 2000ms | `/company/nvidia` cold load | Lighthouse / perf trace | P1 |
| P2 | /api/company-kpis p95 < 800ms | 95th percentile response < 800ms over 50 samples | API perf | timing log | P1 |
| P3 | Tab switch < 100ms | Time from click to aria-selected change < 100ms | tab strip | timing | P1 |
| P4 | /api/stock-chart p95 < 500ms | Same methodology | API perf | timing log | P1 |
| P5 | Bundle delta per sub-PR < 50KB gzip | Each sub-PR adds < 50KB gzip to client bundle | CI bundle report | next build report | P1 |
| P6 | No new long tasks > 200ms | Performance.measure shows no main-thread block > 200ms during tab switch | perf trace | observation | P2 |

## Q. Data Integrity / Canonical Alias Correctness

NVIDIA alias ribbon contains specific surface forms with mention counts. Berkshire shows BRK.B not BRK.A (HARD_TICKER_OVERRIDES). ASML one row post-merge. Palantir one row. X has NULL ticker not XOM. Berkshire row companies.ticker.

| ID | Test | Expected Result | Page/Element | Playwright Selector Hint | Priority |
|----|------|-----------------|--------------|--------------------------|----------|
| Q1 | NVIDIA alias ribbon includes "Nvidia" surface | Alias chip "Nvidia" visible with count > 0 | `/company/nvidia` | `[data-testid="alias-chip"]:has-text("Nvidia")` | P0 |
| Q2 | NVIDIA alias ribbon includes "NVDA" | Chip "NVDA" with count visible | alias ribbon | n/a | P1 |
| Q3 | Berkshire ticker resolves to BRK.B | Header ticker chip reads "BRK.B" not "BRK.A" | `/company/berkshire` | `getByText('BRK.B')` | P0 |
| Q4 | HARD_TICKER_OVERRIDES applied | DB query for canonical ticker returns BRK.B | DB SQL | SQL | P1 |
| Q5 | ASML one row post-merge | Companies table has exactly one ASML row after entity-resolution merge | DB SQL | `SELECT count(*) FROM companies WHERE name ILIKE '%asml%'` = 1 | P0 |
| Q6 | Palantir one row | Same for Palantir | DB SQL | SQL | P0 |
| Q7 | X (Twitter) has NULL ticker | companies.ticker IS NULL for X row, not "XOM" | DB SQL | SQL | P0 |
| Q8 | X detail page renders without ticker chip | Header has no ticker chip element | `/company/x` | `[data-testid="ticker-chip"]` count=0 | P1 |
| Q9 | Berkshire row has companies.ticker='BRK.B' | DB row reflects override | DB SQL | SQL | P1 |
| Q10 | Mention counts on alias chips match DB | Each chip count matches `SELECT count(*) FROM articles WHERE primary_company ILIKE alias` within tolerance | alias ribbon | DB compare | P2 |

## R. Race Conditions / Stale Data

New article ingested -> refresh shows updated mention count. Memo cache invalidation per Phase 2 Q10 (12h client-side TTL in watchlist_briefs keyed by identifier). Concurrent Generate Memo rapid clicks: cache hit OR Patch L useRef sync lock. Watchlist add-then-remove fast toggle.

| ID | Test | Expected Result | Page/Element | Playwright Selector Hint | Priority |
|----|------|-----------------|--------------|--------------------------|----------|
| R1 | New article ingested then refresh updates mention count | Insert article via SQL; refresh page; Mentions 30d KPI increments | DB + reload | SQL + UI compare | P1 |
| R2 | Memo cache 12h TTL | Generate Memo within 12h of last cache returns cached without re-hitting LLM | repeat click | server log | P1 |
| R3 | Concurrent Generate Memo rapid clicks coalesce | 5 fast clicks produce 1 outputs row, not 5 | rapid click + DB | SQL count | P0 |
| R4 | Watchlist add-then-remove fast toggle | KNOWN-FAIL: rapid add immediately followed by remove silently coalesces; second click is dropped. Notes: intended acceptance behavior per src/lib/watchlist-utils.ts inspection -- second click coalesced into first by useRef sync lock from Patch L. WatchlistAddInput uses `submitting` flag to gate re-entry; no remove-after-add path exists in this component, so silent-coalesce is the de facto contract. | watchlist UI | rapid click | KNOWN-FAIL |
| R5 | Watchlist add idempotent | Adding the same identifier twice does not create duplicate row | DB | SQL | P1 |
| R6 | Memo cache invalidates on new article ingest | Phase 2 Q10 contract: new article > memo timestamp -> next Generate Memo re-runs LLM | DB + UI | server log | P2 |
| R7 | Tab switch during pending /api/memo does not abort | Switch from F1 to F2 while memo pending; memo completes in background | tab strip | observation | P1 |

## S. Cross-Browser

Mac Safari, Chrome, iOS Safari iPhone 14, Edge. Categories A-N each. Safari focus-visible polyfill, Yahoo crumb auth, smooth-scroll, Playfair Display rendering.

| ID | Test | Expected Result | Page/Element | Playwright Selector Hint | Priority |
|----|------|-----------------|--------------|--------------------------|----------|
| S1 | Mac Safari -- header + KPI strip render | A1-B11 pass on webkit | webkit project | `playwright.config.ts` projects.webkit | KNOWN-DEFERRED |
| S2 | Mac Safari -- focus-visible polyfill | N4 focus ring shows correctly on Safari | webkit | observation | KNOWN-DEFERRED |
| S3 | Chrome desktop -- full smoke A-N | All P0/P1 in A-N pass on Chromium | chromium | default | KNOWN-DEFERRED |
| S4 | iOS Safari iPhone 14 -- mobile layout | O1-O9 pass on iPhone 14 device emulation | webkit + device | `devices['iPhone 14']` | KNOWN-DEFERRED |
| S5 | Edge -- full smoke A-N | All P0/P1 pass on msedge channel | msedge channel | `channel: 'msedge'` | KNOWN-DEFERRED |
| S6 | Yahoo crumb auth on Safari | M8 BRK-B request succeeds on Safari | webkit | network | KNOWN-DEFERRED |
| S7 | Smooth-scroll on citation click | D6 scroll behavior smooth across browsers | all | observation | KNOWN-DEFERRED |
| S8 | Playfair Display renders | Computed font-family includes Playfair Display on all browsers | all | computed style | KNOWN-DEFERRED |

Note S1-S8: playwright.config.ts requires webkit + msedge channel additions; tracked as PR-A3 (1 LOC config-only addition, ships with Phase 1 sub-PR sequence).

## T. A11y Verification

axe-core scan returns 0 NEW violations beyond 27-violation baseline post Patch N2. aria-label on action buttons. aria-selected on tabs. role="tabpanel". Heading hierarchy h1=name, h2=section. KPI/alias/sentiment chip contrast >= 4.5:1.

| ID | Test | Expected Result | Page/Element | Playwright Selector Hint | Priority |
|----|------|-----------------|--------------|--------------------------|----------|
| T1 | axe-core scan returns no NEW rule-route occurrences beyond 18-occurrence baseline (post Patch N2) | Run @axe-core/playwright on /company/nvidia, /company/stripe; total unique rule x route violations <= 18. Note: node count may exceed 96 because color-contrast on shared chip classes appears across multiple components -- track rule-route occurrences instead per docs/axe-baseline-2026-05-07.md. | full page | `@axe-core/playwright` | P0 |
| T2 | aria-label on + Watchlist button | Button has aria-label e.g. "Add NVIDIA to watchlist" | header | accessibility tree | P1 |
| T3 | aria-label on Export | Export button has descriptive aria-label | header | accessibility tree | P1 |
| T4 | aria-label on Generate Memo | Generate Memo button has descriptive aria-label | header | accessibility tree | P1 |
| T5 | aria-selected on active tab | Active tab has aria-selected="true"; inactive false | tabs | `[aria-selected="true"]` count=1 | P0 |
| T6 | role="tabpanel" on tab content | Active panel has role="tabpanel" with aria-labelledby pointing to tab | panel | accessibility tree | P0 |
| T7 | h1 = canonical company name | Exactly one h1 on page, text equals canonical name | header | `getByRole('heading', { level: 1 })` count=1 | P0 |
| T8 | h2 per section | Each major section uses h2 (Brief sections, Sources, etc.) | content | heading audit | P1 |
| T9 | KPI text contrast >= 4.5:1 | Foreground vs background contrast ratio meets WCAG AA | KPI strip | axe color-contrast | P1 |
| T10 | Alias chip text contrast >= 4.5:1 | Same WCAG AA threshold | alias ribbon | axe color-contrast | P1 |
| T11 | Re-run axe baseline AFTER PR-A0 token swap merges. Expected: rule-route count may shift by +/-2 due to color-contrast sensitivity to gold tone change. Update baseline doc and T1 ceiling if shift exceeds +/-3. | Bullish/neutral/bearish pill text vs background passes 4.5:1 | sentiment pill | axe color-contrast | P1 |
| T12 | Tab strip keyboard navigable | Arrow keys move between tabs per WAI-ARIA tabs pattern | tabs | keyboard | P1 |

## Test data setup

| Scenario | Entity | Path |
|----------|--------|------|
| Public + has memo + has themes | NVIDIA | `/company/nvidia` |
| Public + has memo + has themes | Microsoft | `/company/microsoft` |
| Public + has memo + has themes | Apple | `/company/apple` |
| Public + class share | Berkshire Hathaway | `/company/berkshire` |
| Public + low coverage | Disney | `/company/disney` (mention_count < 5) |
| Public + low coverage | AMD | `/company/amd` (mention_count < 5) |
| Private + watchlisted | Stripe | `/company/stripe` |
| Private + no coverage | Citadel | `/company/citadel` |
| Typo redirect | "Perishing Square" | `/company/perishing-square` (alias seed required, see J-section note) |
| Typo redirect | "Mircosoft" | `/company/mircosoft` (alias seed required) |
| Multi-alias | NVIDIA | `/company/nvidia` |
| Multi-alias | Palantir post-merge | `/company/palantir` |
| Multi-alias | ASML post-merge | `/company/asml` |
| Null-ticker entity | X (Twitter) | `/company/x` |

## Notes / Coordination

### Tests gated on specific sub-PRs landing first

- L1-L9 substrate hooks: gated on PR-D2 (recordOutput integration in `src/app/api/memo/route.ts`). Until then mark all L tests as KNOWN-DEFERRED.
- N1-N3 skip link: gated on PR #213/N1 landing. If not yet merged, mark N1-N3 KNOWN-DEFERRED with note "depends on PR #213".
- O6, O7 tap-target fixes: gated on W2-D follow-up. Stay KNOWN-FAIL until then.
- J1-J9 web-fallback typo path: gated on alias seed work for "Perishing"/"Mircosoft" misspellings. SQL verification on 2026-05-05 returned only canonical "Pershing Square" surface forms; the typo "Perishing" form is NOT seeded. File as W2-D follow-up.
- S1-S8 cross-browser: gated on PR-A3 playwright.config.ts addition (webkit + msedge channel projects).
- G7, M8 BRK-B Yahoo substitution: must remain green; flag as P0 if regression detected.

### KNOWN-FAIL

- O6 watchlist star tap target 21x21 (target >= 44x44, deferred to W2-D).
- O7 search input height 36 (target >= 44, deferred to W2-D).
- R4 watchlist add-then-remove fast toggle: silent-coalesce is the intended acceptance behavior per inspection of `src/lib/watchlist-utils.ts` and `src/components/watchlist/WatchlistAddInput.tsx` (component uses local `submitting` flag and lacks a remove-after-add path; rapid second click is dropped). Re-evaluate if Patch L useRef sync lock semantics change.
- T1 axe baseline 27: ride at <= 27. New violation introduced -> demote priority to P0 fail.

### Playwright translation guide

- Selector preference order: `data-testid` > `getByRole` + accessible name > `getByText` content match > CSS class.
- Auth: tests assume `e2e/auth.setup.ts` storage state is loaded (mirrors existing specs in `e2e/`).
- Network observation: use `page.waitForResponse(/\/api\/memo/)` for L tests, `page.waitForResponse(/yahoo.*chart/)` for M8 / G7.
- Viewport: `page.setViewportSize({ width: 380, height: 800 })` for O tests; default 1280x800 for A-N.
- Keyboard: `page.keyboard.press('Alt+1')` etc. Modifier syntax matches Playwright >= 1.40.
- Performance budgets (P category) run via Lighthouse CI, not Playwright; these rows are reference-only here.
- Cross-browser (S category) requires `playwright.config.ts` to declare `projects` for `chromium`, `webkit`, `firefox`, and `msedge` (channel). PR-A3 adds the missing projects.
- DB assertions in L, Q, R use Supabase service-role client via `tests/helpers/db.ts` (existing helper, no new infra needed).
