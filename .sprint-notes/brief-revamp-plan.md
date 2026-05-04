# Brief Revamp — Design & Dispatch Plan

Based on `brief-revamp-recon.md`. This is the authoritative spec for all subagents.

## Shared design tokens

Heritage Gold `var(--gold)` (light #c9922a / dark #c9a84c). Gradient for brand moments: `linear-gradient(180deg, var(--gold-light) 0%, var(--gold) 55%, var(--gold-dark) 100%)`. Serif display: Playfair. Sans body: Inter. Mono data: JetBrains Mono.

Use `@/components/ui/*` primitives: `Button`, `Wordmark`, `Skeleton`, `EmptyState`. Do NOT introduce new primitives unless clearly shared.

Both light + dark mode must work. All animations respect `prefers-reduced-motion`. When a class won't compile in Tailwind v4, use inline `style={{ color: 'var(--gold)' }}` etc.

## Protected files (absolute)

- `src/app/trends/page.tsx`
- `src/components/trends/**`
- `backend/trends*.py`
- `src/lib/watchlist-utils.ts`
- `src/components/watchlist/WatchlistAddInput.tsx`
- `src/app/api/brief-rating/route.ts` (Lucas)
- `backend/brief_feedback_loop.py` (Lucas)
- `backend/thesis_grader.py` (Lucas — read only, don't modify)
- `src/components/dashboard/collective-signals-widget.tsx` (Lucas)
- `src/components/dashboard/competitor-alerts-widget.tsx` (Lucas)

Caution zone (Lucas touched in last 12h — edit only what your scope requires):

- `src/app/morning-brief/page.tsx` — preserve his section-rating wiring (handleSectionRate, sectionRatings, /api/brief-rating calls). Do NOT remove his user addendum pill.
- `src/app/evening-wrap/page.tsx` — same guardrails.
- `src/components/brief/brief-section.tsx` — preserve his thumb-rating UI if any subagent touches it.

## PR A — `feat/brief-revamp-visual`

Branched from `main` (`63cce09`). All 4 subagents work in worktrees and merge into this branch.

### A-Subagent 1: Market Pulse + Today's Lead (A1 + A2)

**Worktree:** `../breakingalpha-brief-pulse-lead` on `ui-brief-pulse-lead`

**Scope:**
1. Create `src/components/brief/market-pulse.tsx`:
   - Props: `{ pulse?: { sentiment_word: string; narrative: string; headlines?: Array<{ title: string; href?: string }> } }`
   - Renders ABOVE BriefHeader on both Morning Brief and Evening Wrap.
   - Treatment:
     - Label: small-caps "MARKET PULSE" in text-gold.
     - Pull-quote: `"Today the market is "` + gold-gradient-filled serif word (e.g. "anxious"). Use the same gradient-clip-text technique from `Wordmark`.
     - Below: 2-3 paragraph editorial blurb (narrative string with `\n\n` → paragraph breaks).
     - "Headlines driving this:" line + 3 inline links to headlines.
   - Graceful fallback: if `pulse` is null/undefined, render nothing.
   - Light + dark mode.

2. Extend `/api/briefing/route.ts` to pass through `briefing.market_pulse` field if present on the briefings row (add to return shape — frontend will read from `data.briefing.market_pulse`).

3. Create `src/components/brief/lead-hero.tsx`:
   - Replaces what `BriefHeader` currently does for the "Today's Lead" hero.
   - Props: `{ headline: string; summary: string; marketTone?: string; storyCount?: number; generatedAt?: string; isStale?: boolean; lastRunStatus?: ...; onGenerateMemo?; onAddThesis? }` — same shape as BriefHeader.
   - Treatment:
     - Pull-quote at top: first sentence of summary in 20-24px serif italic with gold left-bar accent.
     - 2-3 paragraph summary flow with intentional line breaks (split on `\n\n` or render as `<p>` per sentence if no breaks present).
     - Sentiment tone as subtle inline badge (not a big pill).
     - Bottom meta row: `generatedAt` + storyCount + action buttons (Generate Memo, Add Thesis).
     - No "Skeleton" loading — parent handles loading.
   - Export both `LeadHero` and keep existing `BriefHeader` so other consumers don't break. Or: update `BriefHeader` in place if it's only used by these two pages (grep `<BriefHeader` — if only 2 hits, safe to change).

4. Wire `<MarketPulse />` + `<LeadHero />` into `morning-brief/page.tsx` and `evening-wrap/page.tsx`, replacing current `<BriefHeader />` usage. Preserve Lucas's userAddendum pill that sits below BriefHeader on morning brief.

5. Backend prompt extension — **DEFER unless trivial**: if you can read `backend/synthesize.py` and find a clean insertion point for a `market_pulse` field in the JSON schema it emits, add it. Otherwise skip; frontend renders gracefully when field is absent.

**Tsc/build gate. Commit message:** `feat(brief): market pulse module + lead hero editorial redesign`.

---

### A-Subagent 2: Analyst Briefing toggle + Top Deals + Top Stories + Thumbs (A3 + A4 + A5 + A6)

**Worktree:** `../breakingalpha-brief-bodyredesign` on `ui-brief-body`

**Scope:**
1. **Analyst Briefing toggle (A3):**
   - Add view toggle state with `useState<'editorial' | 'dashboard'>('editorial')`.
   - Persist via `localStorage.setItem('signalera_brief_view', view)`; read on mount.
   - Toggle UI: two buttons in the section header row, similar to Thesis Board's list/board toggle (see `src/app/thesis-board/page.tsx:548-573`).
   - **Editorial mode** (default):
     - Tabbed single-column. Tabs = section keys (deals_and_ma, public_markets, macro_and_rates, sector_spotlight, etc.).
     - Active tab's content renders at full column width with generous typography.
     - Inactive tabs are text labels in a horizontal row above.
     - Tab labels pull from `SECTION_TITLES` map (already in both pages).
   - **Dashboard mode:**
     - Weighted grid. Heuristic: count characters in each section's content string; longest = most signal = gets ~60% of width (full row); next 2-3 are smaller "from the bench" cards below.
     - Grid: `grid-cols-6 gap-2.5`; largest spans `col-span-6`, others `col-span-2`.

2. **Top Deals editorial (A4):**
   - Replace the 3-col fixed grid currently inlined in `morning-brief/page.tsx:412-453`.
   - Extract into a new `src/components/brief/top-deals.tsx` component.
   - Treatment:
     - First deal = feature card: larger typography, company in 18px serif, deal value in gold, 2-line summary.
     - Remaining deals = tight horizontal rows: company (left, serif 14px) | pill for deal type | value (gold mono) | 1-line summary (text-secondary).
   - Use Tailwind utility classes; preserve hover lift behavior from existing sprint work (`.card-hover-lift`).

3. **Top Stories cleanup (A5):**
   - Currently uses `LeadStoryCard` + `CompactStoryCard` from `@/components/dashboard`. Don't modify those — create new `src/components/brief/top-stories.tsx` that renders briefs' top stories with cleaner treatment:
     - Headline: serif 15-16px bold, primary text.
     - Single sentiment DOT (colored circle, no label pill) on the left.
     - Sector: one pill only (no multi-tag badge soup).
     - Source + time: muted 10px text on the right.
     - Signal score + source rate: moved to hover tooltip or expanded row (lucide `<Info>` icon button that expands a small detail row).
   - Uses `StoryData` interface (already defined).
   - Numbered list visual: gold serif numerals (1, 2, 3...) in a dedicated left column.

4. **USEFUL thumbs refinement (A6):**
   - Read `src/components/brief/brief-section.tsx` — Lucas added thumbs there.
   - Replace the "Was this useful?" widget treatment with subtle inline: two lucide `<ThumbsUp>` / `<ThumbsDown>` icons (size 12) that fade in on section hover (opacity 0 → 1 on `group-hover`).
   - When a rating is selected, the chosen thumb stays visible + gets `text-gold`.
   - Keep Lucas's onRate callback wire. Do NOT change the API call. Just restyle.
   - If Lucas's implementation is structurally different enough that restyling requires rewriting, document what you kept vs changed.

**Tsc/build gate. Commit message:** `feat(brief): analyst toggle + top-deals editorial + top-stories + thumbs refinement`.

---

### A-Subagent 3: Export system (A7)

**Worktree:** `../breakingalpha-brief-export` on `ui-brief-export`

**Scope:**
1. `npm install @react-pdf/renderer resend @react-email/components @react-email/render`.

2. Build `src/components/brief/brief-pdf.tsx` (React PDF components):
   - `<BriefPdf briefing={...} />` — renders a printable PDF of the brief.
   - Include: Signalera wordmark + generated-at in header, Market Pulse, Today's Lead, Analyst Briefing sections (all expanded), Top Deals table, Top Stories list.
   - Heritage Gold accents (use PDF-friendly hex values, not CSS vars).
   - Playfair serif for display text, Inter for body. If font loading is tricky, use Helvetica/Times as fallback.
   - Multi-page with proper page breaks.

3. Build `src/components/brief/brief-email.tsx` (react-email components):
   - `<BriefEmail briefing={...} />` — renders HTML email.
   - Inline styles only (Gmail/Outlook compatibility).
   - Simplified layout: no multi-column grids (use single-column stacked).
   - Heritage Gold accents.

4. API routes:
   - `POST /api/brief/export-pdf` → renders `<BriefPdf />` → returns PDF bytes with `Content-Disposition: attachment`.
   - `POST /api/brief/send-email` → reads `{ briefing_id, to: string[], subject? }` → renders `<BriefEmail />` → sends via Resend.
     - Resend: `new Resend(process.env.RESEND_API_KEY)`. From: `process.env.EMAIL_FROM_ADDRESS`.
     - Error if `RESEND_API_KEY` missing: return 503 with `{ error: "Email service not configured. Contact admin." }`.
   - Both routes: auth required (check Supabase session).

5. Component: `src/components/brief/export-menu.tsx`:
   - Replaces both current "Export Brief" and "Share" buttons on both pages.
   - A `<Button variant="secondary">` that opens a dropdown:
     - Download PDF
     - Download as HTML email preview (opens modal with rendered HTML + "copy to clipboard" button)
     - Send to myself (one-click, uses logged-in user's email)
     - Send to others... (opens modal with multi-recipient chip input + optional subject field)
   - Integrates with Subagent 4's Share dropdown — Subagent 3 exports just the export-specific menu items; Subagent 4 builds the full share dropdown that includes these.

6. Env vars to add to `.env.example` (do NOT add real keys):
   ```
   # Email sending via Resend
   RESEND_API_KEY=
   EMAIL_FROM_ADDRESS=briefs@signalera.com
   ```

7. Document Resend DNS setup in a new section of handoff doc (SPF, DKIM, MX records for the sending domain).

**Tsc/build gate. Commit message:** `feat(brief): export system — PDF + HTML email + Resend send`.

---

### A-Subagent 4: Share dropdown + public view (A8)

**Worktree:** `../breakingalpha-brief-share` on `ui-brief-share`

**Scope:**
1. Build `src/components/brief/share-button.tsx`:
   - `<Button variant="secondary">` with dropdown:
     - "Copy link" — copies a PUBLIC URL: `https://{origin}/share/brief/{briefing_id}`.
     - "Open in mail client" — `window.location = mailto:?subject=...&body=...` with briefing URL.
     - "Send via email" — delegates to ExportMenu's send modal (imported component or shared hook). If Subagent 3 not yet merged, implement a stub that shows "Coming soon" toast.
   - Dropdown UI: match account-menu pattern from `src/components/shell/topbar.tsx` (absolute-positioned dropdown with click-outside close).

2. Build public share view at `src/app/share/brief/[id]/page.tsx`:
   - Server component (use Next 13+ app dir pattern).
   - Fetches `briefing` from Supabase by ID via anon key.
   - Renders read-only view — no auth, no personalization, no rating thumbs, no user addendum.
   - Re-uses new MarketPulse + LeadHero + TopDeals + TopStories components from Subagents 1 & 2.
   - If briefing not found: 404 with EmptyState.
   - Include a "Try Signalera" CTA at bottom (link to /auth or /).
   - Add `noindex, nofollow` meta tags so these don't leak into search results.

3. Update `morning-brief/page.tsx` and `evening-wrap/page.tsx` to use `<ShareButton />` where the current Share button renders.

4. Watch for conflicts with Subagent 3's export-menu integration — coordinate via handoff doc. Ship independently; orchestrator merges.

**Caveat:** The public view has an RLS dependency. The `briefings` table must allow public read of rows where... actually, simplest: add a SQL migration (emit to `sql/0004_briefings_public_read.sql`) that creates an RLS policy `briefings_public_select` allowing anon to read latest briefing rows. Document in handoff — do NOT run the DDL.

**Tsc/build gate. Commit message:** `feat(brief): share dropdown + public read-only view`.

---

## PR B — `feat/brief-revamp-grading`

Branched from `main` (`63cce09`). All 3 subagents work in worktrees and merge into this branch.

### B-Subagent 1: Schema + Morning Brief prompt restructure (B1 + B2)

**Worktree:** `../breakingalpha-grading-schema` on `bg-schema-prompt`

**Scope:**
1. Emit `sql/0003_brief_self_grading.sql`:
   ```sql
   CREATE TABLE IF NOT EXISTS morning_brief_calls (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     brief_id uuid NOT NULL REFERENCES briefings(id) ON DELETE CASCADE,
     brief_date date NOT NULL DEFAULT CURRENT_DATE,
     claim_text text NOT NULL,
     claim_type text NOT NULL CHECK (claim_type IN ('aggregate', 'sector', 'index', 'ticker')),
     target_symbol text,
     expected_direction text NOT NULL CHECK (expected_direction IN ('bullish','bearish','neutral')),
     confidence numeric CHECK (confidence >= 0 AND confidence <= 1),
     created_at timestamptz NOT NULL DEFAULT now()
   );
   CREATE INDEX IF NOT EXISTS idx_mbc_brief_id ON morning_brief_calls(brief_id);
   CREATE INDEX IF NOT EXISTS idx_mbc_brief_date ON morning_brief_calls(brief_date);

   CREATE TABLE IF NOT EXISTS morning_brief_call_outcomes (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     call_id uuid NOT NULL REFERENCES morning_brief_calls(id) ON DELETE CASCADE,
     actual_open numeric,
     actual_close numeric,
     actual_pct_change numeric,
     actual_direction text NOT NULL CHECK (actual_direction IN ('up','down','flat')),
     verdict text NOT NULL CHECK (verdict IN ('correct','wrong','partial')),
     verdict_notes text,
     graded_at timestamptz NOT NULL DEFAULT now()
   );
   CREATE INDEX IF NOT EXISTS idx_mbco_call_id ON morning_brief_call_outcomes(call_id);

   -- RLS: public read, service_role write
   ALTER TABLE morning_brief_calls ENABLE ROW LEVEL SECURITY;
   CREATE POLICY IF NOT EXISTS "public read mbc" ON morning_brief_calls FOR SELECT USING (true);
   ALTER TABLE morning_brief_call_outcomes ENABLE ROW LEVEL SECURITY;
   CREATE POLICY IF NOT EXISTS "public read mbco" ON morning_brief_call_outcomes FOR SELECT USING (true);
   ```
   - `FOREIGN KEY(brief_id) REFERENCES briefings(id)` — confirm briefings table has `id uuid` primary key. (From recon: briefings exists; likely uuid id.) If not, drop the FK and add `brief_id uuid NOT NULL` only.

2. Extend Morning Brief generation (`backend/synthesize.py`):
   - Find where the Gemini response is parsed into briefing fields (sections, top_deals, sector_breakdown).
   - Add a **second, additive** LLM call AFTER the main brief synthesis: pass the brief text + ask Gemini to extract a structured `claims` array with JSON schema:
     ```json
     {
       "claims": [
         {
           "claim_text": "S&P is likely to close higher on Fed dovish tone",
           "claim_type": "aggregate",
           "target_symbol": "SPY",
           "expected_direction": "bullish",
           "confidence": 0.65
         }
       ]
     }
     ```
   - Full try/except: if claims extraction fails (JSON parse error, API error, empty response), log warning and continue. Brief still ships with no claims data.
   - After successful extraction, insert rows into `morning_brief_calls` via Supabase admin client.
   - Structure as a separate function `extract_and_persist_claims(brief_id, brief_text)` so it's easy to review.

3. Handle duplicate runs (idempotent):
   - If `morning_brief_calls` already has rows for this `brief_id`, skip extraction (or delete + re-insert — pick one, document).

4. Env: uses existing Supabase service role key + Gemini key — no new env vars.

**Python run gate: `python -m py_compile backend/synthesize.py`. Commit message:** `feat(grading): schema + morning brief claims extraction`.

---

### B-Subagent 2: Market outcome grading job (B3)

**Worktree:** `../breakingalpha-grading-job` on `bg-grading-job`

**Scope:**
1. Create `backend/grading/grade_brief_calls.py`:
   - Standalone script, entry point.
   - Reads ungraded calls: `SELECT * FROM morning_brief_calls c WHERE NOT EXISTS (SELECT 1 FROM morning_brief_call_outcomes o WHERE o.call_id = c.id)`.
   - Default: grade calls from today's brief only (`brief_date = CURRENT_DATE`); optional `--backfill` flag to grade all ungraded.
   - For each call:
     1. Determine symbol for Finnhub query:
        - `aggregate` → SPY (default US broad)
        - `index` → use `target_symbol` (SPY, QQQ, DIA)
        - `sector` → sector ETF map (XLK for tech, XLE for energy, XLF for financials, XLV for health, XLY for consumer disc, XLP for consumer staples, XLI for industrials, XLB for materials, XLRE for real estate, XLU for utilities, XLC for communications). If unmapped, skip with warning.
        - `ticker` → use `target_symbol` directly.
     2. Call Finnhub `/quote` endpoint via `requests`: https://finnhub.io/api/v1/quote?symbol={symbol}&token={FINNHUB_API_KEY}
     3. Get `o` (open), `c` (close), `pc` (prev close). Compute pct_change = (c - o) / o.
     4. actual_direction = "up" if pct > 0.1%, "down" if pct < -0.1%, else "flat".
     5. Verdict: "correct" if expected matches actual, "wrong" if opposite, "partial" if neutral expected + up/down actual or expected direction but flat actual.
     6. Call Gemini to generate verdict_notes: 1-2 sentences of honest reasoning. Include the claim text + expected vs actual. Optional: call Exa AI with the claim as query to fetch supplementary mid-day news (1-2 top results) for extra context.
     7. Insert into `morning_brief_call_outcomes`.
   - Handle errors gracefully: skip calls where market data fetch fails, log warning, continue.
   - Weekend/holiday handling: if Finnhub returns stale data (timestamp < today), skip grading for that call (log "market closed"); re-run after next trading session.

2. Create API endpoint `src/app/api/grading/grade-brief/route.ts`:
   - `POST /api/grading/grade-brief` — triggers the grading job via GitHub repository_dispatch (same pattern as existing `api/grading/trigger` for thesis grading).
   - Auth: `x-internal-key` header must match `INTERNAL_API_KEY`.

3. Create GitHub workflow `.github/workflows/brief-grading.yml`:
   - Triggered by `repository_dispatch` with `event_type: grade-brief`.
   - Runs `python backend/grading/grade_brief_calls.py`.
   - Set timeout 10 min.

4. Document in handoff:
   - Cron-job.org entry: `POST https://signalera.ai/api/grading/grade-brief` with header `x-internal-key: ${INTERNAL_API_KEY}`. Schedule: 5:00 PM PT daily (after market close).
   - New env vars: none (Finnhub + Gemini already configured).

**Python compile gate + tsc/build for the route. Commit:** `feat(grading): brief call outcome grading job`.

---

### B-Subagent 3: Evening Wrap reflection + UI (B4 + B6)

**Worktree:** `../breakingalpha-grading-reflection` on `bg-reflection`

**Scope:**
1. Backend: Extend `backend/synthesize.py` evening wrap generation (or wherever evening wrap is synthesized — check run.py / synthesize.py for `generate_evening` or similar):
   - After synthesizing the evening wrap content, query `morning_brief_call_outcomes` for today's calls.
   - If no graded calls yet: skip reflection section entirely (set `briefing.morning_review = null`).
   - If graded calls exist:
     - Aggregate: count correct/wrong/partial. Derive aggregate_verdict string.
     - Group by sector for sector-specific reflections.
     - Call Gemini to write reflection JSON:
       ```json
       {
         "aggregate_sentence": "Morning brief leaned bullish. S&P closed +0.3%. We were directionally right.",
         "sector_reflections": [
           { "sector": "Technology", "verdict": "correct", "paragraph": "..." }
         ],
         "ticker_reflection": { "symbol": "NVDA", "verdict": "wrong", "paragraph": "..." } | null
       }
       ```
     - 200-400 words total. Tone: confident, honest, never defensive.
   - Write to `briefings.morning_review` JSONB column (add to schema if missing — emit additional SQL in `sql/0005_briefings_morning_review_column.sql`).
   - Full try/except; reflection section is optional.

2. Frontend: Create `src/components/brief/morning-review.tsx`:
   - Props: `{ review?: MorningReview }` where MorningReview matches backend JSON.
   - Graceful fallback: if review is null/undefined, render nothing.
   - Treatment:
     - Section label: "MORNING BRIEF REVIEW" in small-caps gold.
     - Aggregate verdict: 18-20px serif, prominent.
     - Sector reflections: 2-3 cards in a tight vertical list with verdict badge (correct/wrong/partial colored pill) + paragraph.
     - Optional ticker reflection: single larger card at bottom.
     - Confident typography; avoid apologetic visual cues.
   - Light + dark mode.

3. Wire into `src/app/evening-wrap/page.tsx`:
   - Place `<MorningReview review={briefing?.morning_review} />` between the Lead Hero and the Analyst Briefing sections.
   - If PR A's LeadHero isn't merged yet, place it below the existing BriefHeader.

4. Backend API: update `src/app/api/briefing/route.ts` to pass through `briefing.morning_review` on the evening wrap response. Do NOT touch the personalization logic.

**Tsc/build gate + Python compile. Commit:** `feat(grading): evening wrap reflection section + UI`.

---

## Orchestration rules

- 7 subagents (4 for PR A, 3 for PR B) run **in parallel** in their own worktrees.
- Each subagent writes + commits + runs tsc/build + reports back.
- Orchestrator merges to PR branch as each reports (order: lowest-conflict first).
- Expected conflict zones:
  - `src/app/morning-brief/page.tsx` (A-1, A-2, A-3, A-4 all touch it) — merge order: A-1 first (hero), then A-2 (analyst + deals + stories), then A-3 (export menu), then A-4 (share button).
  - `src/app/evening-wrap/page.tsx` (A-1, A-2, A-3, A-4, B-3 all touch it).
  - `src/app/api/briefing/route.ts` (A-1 + B-3 both touch). Additive changes should merge cleanly.
  - `backend/synthesize.py` (B-1 + B-3 both touch). Different functions, should merge.

- After PR A subagents all merge, run final build + push + open PR.
- Same for PR B.

## Manual setup for Noah (consolidated in handoff)

1. Run SQL: `sql/0003_brief_self_grading.sql`, `sql/0004_briefings_public_read.sql`, `sql/0005_briefings_morning_review_column.sql`.
2. Add Resend env vars: `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS`. Configure domain DNS (SPF, DKIM — Resend dashboard provides records).
3. Add cron-job.org entry for brief grading: 5:00 PM PT daily → `POST /api/grading/grade-brief` with `x-internal-key` header.
4. Visually QA both PRs on their Vercel preview URLs before merging.

---

Plan is frozen. Proceeding to Phase 2 (dispatch).
