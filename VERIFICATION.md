# Signalera — Feature Verification Checklist

> Manual QA checklist covering every user-facing feature.
> Test in order — auth must pass before anything else.

---

## 1. Authentication

### 1.1 Email Sign In
- **What it does:** Authenticates user with email + password, redirects to dashboard.
- **Steps:**
  1. Navigate to `/auth`
  2. Ensure "Sign In" tab is active
  3. Enter valid email and password
  4. Click "Sign In"
  5. Confirm redirect to `/dashboard`
- **Failure:** Error banner appears (red box with Supabase error message), or page stays on `/auth` with no feedback.

### 1.2 Email Sign Up
- **What it does:** Creates new account, shows email confirmation message.
- **Steps:**
  1. Navigate to `/auth`
  2. Click "Create Account" tab
  3. Enter new email and password
  4. Click "Create Account"
  5. Confirm "Check your email" success card appears
  6. Click "Back to sign in" — confirm mode switches
- **Failure:** Error banner shows (e.g. "User already registered"), or no success card appears.

### 1.3 Google SSO
- **What it does:** Redirects to Google OAuth, then back to `/auth/callback`, then to `/dashboard`.
- **Steps:**
  1. Navigate to `/auth`
  2. Click "Continue with Google"
  3. Complete Google sign-in flow
  4. Confirm redirect to `/dashboard`
- **Failure:** Stays on Google error page, or redirects to `/auth?error=...`.

### 1.4 Forgot Password Toast
- **What it does:** Shows "Password reset coming soon" toast (feature placeholder).
- **Steps:**
  1. On sign-in mode, click "Forgot password?"
  2. Confirm gold "Password reset coming soon." text appears below the link
  3. Confirm it disappears after ~3 seconds
- **Failure:** Nothing happens on click, or toast never disappears.

### 1.5 Route Protection
- **What it does:** Unauthenticated users are redirected to `/auth`; authenticated users on `/auth` redirect to `/dashboard`.
- **Steps:**
  1. Sign out (clear cookies), navigate to `/dashboard` — confirm redirect to `/auth`
  2. Sign in, navigate to `/auth` — confirm redirect to `/dashboard`
- **Failure:** Unauthenticated user sees dashboard, or authenticated user gets stuck on `/auth`.

---

## 2. Dashboard

### 2.1 Greeting
- **What it does:** Shows personalized time-based greeting with user's first name, date, and market status.
- **Steps:**
  1. Navigate to `/dashboard`
  2. Confirm greeting says "Good morning/afternoon/evening, [your name]."
  3. Confirm date line shows current weekday and date
  4. Confirm market status: "Markets Open" (Mon-Fri 9:30-16:00 EST) or "Markets Closed"
- **Failure:** Shows "Good morning, there." (name not resolved), wrong time of day, or skeleton never resolves.

### 2.2 Stat Cards
- **What it does:** Displays 4 market stat cards (S&P 500, VIX, 10Y Yield, Signals Today) with sparklines.
- **Steps:**
  1. Confirm 4 cards render with labels, values, and % changes
  2. Hover each card — confirm detail rows fade in and bar chart transitions to sparkline
  3. Confirm "Signals Today" shows live article count from database
- **Failure:** Cards show "0" or "NaN", hover has no effect, sparklines don't appear.

### 2.3 AI Signal Bar
- **What it does:** Shows AI-generated market insight with link to appropriate briefing.
- **Steps:**
  1. Confirm gold sparkles icon + "Signalera AI · Live Signal" label
  2. Confirm signal text renders with bold highlights
  3. Before 5 PM: CTA should say "Get full AI briefing" and link to `/morning-brief`
  4. After 5 PM: CTA should say "Get evening wrap" and link to `/evening-wrap`
- **Failure:** CTA links to wrong page, text is empty, or bold parts not highlighted.

### 2.4 Top Stories
- **What it does:** Displays top 4 stories from Supabase `articles` table (1 lead + 3 compact).
- **Steps:**
  1. Confirm lead story card shows: sentiment badge, sector tag, source, timestamp, headline
  2. Hover lead story — confirm summary, company tags, and action buttons appear
  3. Confirm 3 compact stories below with numbered labels (2, 3, 4)
  4. Click "View all →" — confirm navigation to `/live-feed`
- **Failure:** Shows "No stories yet" empty state when articles exist, or skeleton never resolves.

### 2.5 Story Card Actions
- **What it does:** Each story card has Bookmark, Generate Memo, Add to Thesis, and Ask AI buttons.
- **Steps:**
  1. Hover a story card to reveal action buttons
  2. Click bookmark icon — confirm it toggles to filled state
  3. Click "Generate Memo" — confirm MemoModal opens
  4. Click "Add to Thesis" — confirm spinner, then redirect to `/thesis-board`
  5. Click "Ask AI" — confirm command palette (Cmd+K) opens
- **Failure:** Buttons don't appear on hover, memo modal doesn't open, thesis insert fails silently.

### 2.6 Onboarding Banner
- **What it does:** Shows welcome banner for new users, dismissible.
- **Steps:**
  1. Clear `signalera_onboarded` from localStorage
  2. Reload `/dashboard` — confirm banner appears
  3. Click X to dismiss — confirm it disappears
  4. Reload — confirm it stays hidden
- **Failure:** Banner never appears, or reappears after dismiss.

### 2.7 Personalization Banner
- **What it does:** Prompts user to select sectors/topics for better signals.
- **Steps:**
  1. Clear `signalera_personalization_dismissed` from localStorage
  2. Reload — confirm banner appears
  3. Click X to dismiss — confirm it disappears
  4. Click "Set interests →" — confirm navigation to `/settings`
- **Failure:** Banner never shows, or link goes to wrong page.

### 2.8 Right Panel Widgets
- **What it does:** Collapsible right panel with Daily Briefs, Active Theses, and Watchlist widgets.
- **Steps:**
  1. Confirm right panel is visible with 3 widgets
  2. Click panel toggle — confirm it collapses
  3. Reload — confirm panel state persists (localStorage)
  4. Daily Briefs: toggle between Morning/Evening, click "Read full brief →"
  5. Active Theses: click a thesis card — confirm navigation to `/thesis-board`
  6. Watchlist: click a ticker — confirm navigation to `/company/{ticker}`
- **Failure:** Panel doesn't toggle, state doesn't persist, links broken.

---

## 3. Live Feed

### 3.1 Article List
- **What it does:** Shows 100 most recent articles grouped by time (Last Hour, Today, Yesterday, Earlier).
- **Steps:**
  1. Navigate to `/live-feed`
  2. Confirm articles render with sentiment badges, sector tags, source, timestamp
  3. Confirm time grouping headers appear
  4. Confirm new-article pulse indicator (green dot) on "LAST HOUR" if recent articles exist
- **Failure:** Skeleton never resolves, articles ungrouped, or empty when DB has data.

### 3.2 Filters
- **What it does:** 7 filter tabs (All, Earnings, M&A, Macro, Sector, Alerts, Saved) with count badges.
- **Steps:**
  1. Click each filter tab — confirm article list updates
  2. "Alerts" — shows only bearish/risk-off from last 48h
  3. "Saved" — shows only bookmarked articles
  4. Confirm count badges update per filter
- **Failure:** Filters don't change list, counts show 0 when items exist, or wrong articles shown.

### 3.3 Sort
- **What it does:** Sort dropdown with 4 options.
- **Steps:**
  1. Click sort dropdown
  2. Select "By relevance" — confirm highest-scored articles first
  3. Select "Oldest first" — confirm reverse chronological order
- **Failure:** Sort has no effect, or dropdown doesn't open.

### 3.4 Auto-Refresh
- **What it does:** Refreshes article list every 60 seconds, manual refresh button available.
- **Steps:**
  1. Click refresh button — confirm spinner animation and data reload
  2. Confirm "Last refreshed" timestamp updates
  3. Wait 60 seconds — confirm auto-refresh fires
- **Failure:** Manual refresh does nothing, or auto-refresh never fires.

### 3.5 Feed Row Actions
- **What it does:** Hover reveals bookmark, memo, thesis, source link, and Ask AI buttons.
- **Steps:**
  1. Hover an article row — confirm it expands showing summary and action buttons
  2. Click bookmark — confirm toggle and "Saved to reading list" toast
  3. Click "Generate Memo" — confirm modal opens
  4. Click thesis button — if sector match exists, redirects to thesis board; otherwise shows "No thesis found" toast
  5. Click source link — opens article URL in new tab
- **Failure:** Row doesn't expand, buttons missing, toast doesn't appear.

---

## 4. Thesis Board

### 4.1 Thesis Generation
- **What it does:** AI generates 5 investment theses from recent articles via Groq.
- **Steps:**
  1. Navigate to `/thesis-board`
  2. If empty, click "Generate Theses" button
  3. Confirm loading state ("Generating...")
  4. Confirm 5 thesis cards appear in list
  5. Confirm each has: title, conviction badge (BULLISH/BEARISH/WATCH), sector, score
- **Failure:** Error banner appears ("Groq returned no valid theses — retry"), button stays in loading state, or 0 theses created.

### 4.2 Thesis List & Filtering
- **What it does:** Filterable list of theses by conviction.
- **Steps:**
  1. Click "Bullish" filter — confirm only BULLISH theses shown
  2. Click "Bearish" — confirm only BEARISH shown
  3. Click "Watch" — confirm only WATCH shown
  4. Click "All" — confirm full list
  5. Confirm count badges match actual counts
- **Failure:** Filter shows wrong items, counts are incorrect.

### 4.3 Thesis Detail Panel
- **What it does:** Right panel shows full thesis analysis with evidence, catalyst, notes, and actions.
- **Steps:**
  1. Click a thesis in the list
  2. Confirm panel shows: score ring, title, conviction badge, sector, rationale text
  3. Confirm "Live Evidence Feed" section shows related articles with support/contradicts/neutral tags
  4. Confirm "Catalyst" section shows catalyst note
  5. Type in "Your Notes" textarea — confirm auto-save checkmark appears
  6. Click "Save to thesis" — confirm "Saved to thesis" toast
- **Failure:** Panel empty, evidence tags wrong color, notes don't save, toast doesn't appear.

### 4.4 Thesis Regeneration
- **What it does:** Re-generates rationale, catalyst note, and evidence chain via Groq.
- **Steps:**
  1. In detail panel, click "Regenerate" button
  2. Confirm loading state
  3. Confirm rationale, catalyst note, and evidence update with new content
  4. Confirm "Regenerated" toast
- **Failure:** Toast says "Failed to regenerate", content doesn't change.

### 4.5 Thesis Archive
- **What it does:** Moves thesis to archived state (2-step confirmation).
- **Steps:**
  1. In detail panel footer, click "Archive"
  2. Confirm "Archive?" prompt with Yes/No buttons
  3. Click "Yes" — confirm thesis disappears from active list
  4. Click "Archived" filter tab — confirm thesis appears there
  5. Click "Restore" on archived thesis — confirm it returns to active list
- **Failure:** No confirmation prompt, thesis stays in active list, restore doesn't work.

### 4.6 Stats Row
- **What it does:** 4 stat cards showing thesis counts by conviction.
- **Steps:**
  1. Confirm cards show: Total signals, Strong signals, Bullish count, Bearish count
  2. Click "Archived" tab — confirm stats switch to: Archived, Bullish, Bearish, Watch
  3. Confirm colors: Bullish = signal-up (green), Bearish = signal-dn (red), Watch = signal-warn (amber)
- **Failure:** Counts are wrong, colors don't match conviction.

---

## 5. Deal Flow

### 5.1 Deal List
- **What it does:** Displays AI-extracted and manual deals in a filterable list.
- **Steps:**
  1. Navigate to `/deal-flow`
  2. Confirm deal cards render with: company, acquirer, status badge, value, deal type, sector
  3. Confirm status badges use correct colors (RUMORED=amber, ANNOUNCED=green, UNDER LOI=blue, CLOSED=gray)
- **Failure:** Skeleton never resolves, empty state when deals exist in DB.

### 5.2 Add Deal
- **What it does:** Manual deal entry form.
- **Steps:**
  1. Click "+ Add Deal" button — confirm form appears
  2. Fill required field (Company)
  3. Select deal type, status, sector from dropdowns
  4. Click "Save Deal" — confirm deal appears in list
  5. Click "Cancel" — confirm form closes without saving
- **Failure:** Form doesn't appear, validation doesn't enforce required field, deal doesn't save.

### 5.3 Deal Filters & Search
- **What it does:** Filter by stage and search by company/acquirer name.
- **Steps:**
  1. Type in search bar — confirm list filters in real-time
  2. Click stage tabs (ALL, RUMORED, ANNOUNCED, etc.) — confirm filter applies
  3. Confirm count badges on each tab
- **Failure:** Search doesn't filter, stage tabs show wrong counts.

### 5.4 Deal Card Actions
- **What it does:** Expand deal for details, add to watchlist, generate memo.
- **Steps:**
  1. Click deal card — confirm it expands showing signal, notes, source
  2. Click star icon — confirm it changes to checkmark (added to watchlist)
  3. Click "Generate Memo" — confirm MemoModal opens with deal context
  4. If source URL exists, click "Read Source" — confirm opens in new tab
- **Failure:** Card doesn't expand, watchlist add fails, memo modal empty.

---

## 6. Watchlist

### 6.1 Add Items
- **What it does:** Add tickers, companies, or sectors to watchlist.
- **Steps:**
  1. Navigate to `/watchlist`
  2. Select type (TICKER/COMPANY/SECTOR)
  3. Enter identifier (e.g., "AAPL") and click ADD
  4. Confirm item appears in watchlist with validation (Finnhub lookup for tickers)
  5. Try quick-add sector buttons — confirm they add and show checkmark when already tracked
- **Failure:** Error message "Not found" for valid tickers, or item doesn't appear after add.

### 6.2 Live Quotes
- **What it does:** Displays real-time prices and % changes for ticker-type items.
- **Steps:**
  1. Add a ticker (e.g., AAPL)
  2. Confirm price and % change display with color coding (green up, red down)
  3. Confirm stats row updates: Watching count, Gainers, Losers, Flat
- **Failure:** Price shows "—" indefinitely, wrong % change, stats all zero.

### 6.3 Delete Items
- **What it does:** Removes items from watchlist.
- **Steps:**
  1. Hover a watchlist row — confirm trash icon appears
  2. Click trash icon — confirm item is removed
  3. Reload page — confirm item stays removed
- **Failure:** Item reappears after reload, or trash icon doesn't appear.

### 6.4 Watchlist Feed
- **What it does:** Shows articles matching watchlist items.
- **Steps:**
  1. Add items to watchlist
  2. Scroll to "Watchlist Feed" section
  3. Confirm articles related to tracked items appear
- **Failure:** Feed always empty despite matching articles in DB.

---

## 7. Morning Brief

### 7.1 Briefing Content
- **What it does:** AI-generated morning market briefing with sections and sector analysis.
- **Steps:**
  1. Navigate to `/morning-brief`
  2. Confirm ticker strip scrolls at top with live prices
  3. Confirm header shows: date, market tone badge (BULLISH/BEARISH/MIXED), story count
  4. Confirm briefing sections render (Macro & Rates, Deals & M&A, Public Markets, etc.)
  5. Confirm sector signals render with sector-colored left borders
  6. Confirm "Top Deals to Watch" grid (if deals exist)
- **Failure:** "No morning brief available" empty state, sections empty, ticker strip shows "—" for all prices.

### 7.2 Section Actions
- **What it does:** Each section can generate memos and create theses.
- **Steps:**
  1. Click a section to expand
  2. Click "Generate Memo" — confirm MemoModal opens with section content
  3. Click "Add to Thesis Board" — confirm redirect to `/thesis-board`
- **Failure:** Section doesn't expand, memo content empty, thesis insert fails.

### 7.3 Export & Share
- **What it does:** Export brief as text file, copy share link.
- **Steps:**
  1. Click "Export Brief" — confirm .txt file downloads
  2. Click "Share" — confirm "Link copied" toast appears
  3. Verify clipboard contains current page URL
- **Failure:** No download, toast doesn't appear, wrong URL copied.

### 7.4 Sector Filter
- **What it does:** Filter sector signals by specific sector.
- **Steps:**
  1. Click sector filter buttons (All, Technology, Healthcare, etc.)
  2. Confirm sector signal cards filter accordingly
- **Failure:** Filter has no effect, or shows wrong sectors.

---

## 8. Evening Wrap

### 8.1 Evening Content
- **What it does:** Identical structure to Morning Brief but for end-of-day analysis.
- **Steps:**
  1. Navigate to `/evening-wrap`
  2. Confirm header says "Evening Wrap" with "Session closed" mood
  3. Confirm sections labeled "Evening Analysis"
  4. Confirm "Today's Top Stories" section with lead + compact cards
  5. Verify all section actions work (memo, thesis, export, share)
- **Failure:** "No evening wrap available" empty state, or shows morning data.

---

## 9. Company Intel

### 9.1 Company Grid
- **What it does:** Displays companies extracted from articles with mention counts.
- **Steps:**
  1. Navigate to `/company`
  2. Confirm 2-column grid of company cards (max 40)
  3. Each card shows: company name, mention count, sector badges (up to 2)
  4. Type in search bar — confirm grid filters by company name
- **Failure:** Grid empty despite articles with companies, search doesn't filter.

### 9.2 Company Detail Panel
- **What it does:** Side panel showing company details and related articles.
- **Steps:**
  1. Click a company card — confirm gold border highlight and right panel opens
  2. Confirm panel shows: company name, mention count, sector badges
  3. Click "Add to Watchlist" — confirm success
  4. Click "Generate Memo" — confirm MemoModal opens
  5. Confirm related articles list with sentiment, source, summary
  6. Click X — confirm panel closes
- **Failure:** Panel doesn't open, articles list empty, watchlist add fails.

---

## 10. Ticker Strip

### 10.1 Live Prices
- **What it does:** Scrolling strip of 12 market symbols with live prices.
- **Steps:**
  1. Navigate to `/morning-brief` or `/evening-wrap`
  2. Confirm strip scrolls horizontally with: symbol, price, % change with arrow
  3. Confirm green ▲ for positive, red ▼ for negative changes
  4. Wait 60 seconds — confirm prices refresh
- **Failure:** All prices show "—", strip doesn't scroll, colors wrong.

---

## 11. Settings

### 11.1 Profile
- **What it does:** Edit name, email, role, sector interests, and brief modules.
- **Steps:**
  1. Navigate to `/settings`
  2. Confirm "Profile" tab is active
  3. Edit Full Name, confirm input updates
  4. Toggle sector interest buttons — confirm multi-select
  5. Toggle brief module buttons
  6. Click "Save Changes" — confirm "Saved" feedback
- **Failure:** Form doesn't save, "Saving..." never resolves, selections don't persist.

### 11.2 Notifications
- **What it does:** Toggle 7 notification preferences.
- **Steps:**
  1. Click "Notifications" tab
  2. Toggle each switch (Breaking News, Signal Updates, AI Memo Ready, etc.)
  3. Reload — confirm toggle states persist (localStorage)
- **Failure:** Toggles reset on reload.

### 11.3 Integrations
- **What it does:** Shows 4 integration options, all "Coming soon".
- **Steps:**
  1. Click "Integrations" tab
  2. Confirm 4 rows: Slack, Bloomberg Terminal, Notion, Google Sheets
  3. Confirm each shows "Coming soon" badge and disabled "Connect" button
- **Failure:** Connect button is clickable, or badge missing.

### 11.4 Appearance
- **What it does:** Toggle between light/dark theme and comfortable/compact density.
- **Steps:**
  1. Click "Appearance" tab
  2. Click "Dark Mode" — confirm entire app switches to dark theme
  3. Click "Cream & Parchment" — confirm light theme
  4. Toggle density to "Compact" — confirm saved
  5. Reload — confirm theme persists
- **Failure:** Theme doesn't switch, or resets on reload.

---

## 12. Onboarding

### 12.1 Three-Step Wizard
- **What it does:** Guides new users through role, sectors, and watchlist setup.
- **Steps:**
  1. Navigate to `/onboarding`
  2. **Step 1 — Role:** Select a role, click Continue
  3. **Step 2 — Sectors:** Select at least 1 sector, click Continue
  4. **Step 3 — Watchlist:** Add at least 3 tickers, click "Launch Signalera"
  5. Confirm redirect to `/dashboard`
  6. Confirm `signalera_onboarded_{userId}` set in localStorage
- **Failure:** Continue button enabled without selection, wizard doesn't advance, redirect fails.

### 12.2 Skip & Back Navigation
- **What it does:** Skip onboarding or go back to previous step.
- **Steps:**
  1. On Step 1, click "Skip for now" — confirm redirect to dashboard
  2. On Step 2, click Back — confirm return to Step 1 with selection preserved
  3. Confirm step indicator highlights current step
- **Failure:** Back loses previous selections, skip doesn't redirect.

---

## 13. Shell & Navigation

### 13.1 Sidebar Navigation
- **What it does:** Fixed sidebar with all page links, active state highlighting.
- **Steps:**
  1. Click each nav item — confirm correct page loads
  2. Confirm active page is highlighted (gold/bold)
  3. Confirm Morning Brief has live dot indicator
  4. Confirm user card at bottom shows name, role, and initials avatar
- **Failure:** Wrong page highlighted, links broken, user card shows "User" / empty.

### 13.2 Command Palette
- **What it does:** Global search/navigation via Cmd+K shortcut.
- **Steps:**
  1. Press Cmd+K (or Ctrl+K) — confirm palette opens
  2. Type a page name — confirm results filter
  3. Use arrow keys to navigate, Enter to select — confirm navigation
  4. Press Esc — confirm palette closes
  5. Confirm "No results found" when search has no matches
- **Failure:** Shortcut doesn't open palette, navigation doesn't work, palette doesn't close.

### 13.3 Mood Bar
- **What it does:** Colored status bar showing current market regime.
- **Steps:**
  1. Confirm mood bar appears below sidebar, above topbar
  2. Confirm colored dot and badge (Risk-Off=red, Risk-On=green, Neutral=amber)
  3. Confirm headline and detail chips render
- **Failure:** Mood bar missing, wrong colors for regime type.

---

## Quick Reference: Data Dependencies

| Feature | Requires |
|---------|----------|
| Auth | Supabase Auth + Google OAuth configured |
| Dashboard stories | `articles` table with data |
| Thesis generation | `articles` table + Groq API key |
| Thesis detail | Groq API key |
| Live quotes | Finnhub API key |
| Morning/Evening brief | `/api/briefing` endpoint + `articles` table |
| Watchlist validation | Finnhub API key |
| Deal flow | `deal_flow` table |
| Company intel | `articles` table with `companies` JSON |
