# RECON Notes — Personalization Build Pre-flight

> Written 2026-04-16 before Phase 0 of the massive personalization sprint. These are the
> observations that informed the build plan. Anything stated here is "ground truth as of
> this commit" — code may have diverged since.

---

## 1. Repository Shape

- Single repo at `~/Desktop/signalera`. Git remote: `lucasturcuato-afk/breakingalpha`.
- Next.js frontend at repo root (`src/app`, `src/components`, …).
- Python pipeline at `backend/` (`ingest.py`, `synthesize.py`, `run.py`, etc.).
- **Key**: There is no `tailwind.config.*` file — Tailwind v4 CSS-based config lives inside
  `src/app/globals.css` under `@theme inline`. The gold token is `--gold` / `--color-gold`.

## 2. Node.js / Framework

- `next` = `16.2.2`.
- `react` = `19.2.4`.
- `@supabase/ssr` = `^0.10.0` (modern cookie-based client, NOT the deprecated auth-helpers).
- `@google/genai` = `^1.49.0` (use `genai.Client(api_key=...)` on the Python side; the JS
  SDK uses `new GoogleGenAI({ apiKey })`).
- `@supabase/supabase-js` = `^2.101.1`.
- No AI SDK / AI Gateway usage in this project — direct Google `@google/genai` + API key.

## 3. Existing Personalization Layer

The project already has a partial personalization foundation — the build below extends it,
it does NOT create it from scratch.

### Already exists
- `user_profiles` table (inferred from `/api/user-profile/route.ts` + onboarding flow).
  Columns referenced: `id, full_name, role, firm, sectors, risk_appetite, watchlist_tickers,
  onboarding_completed, updated_at`.
- `/api/user-profile/route.ts` — GET + PATCH with whitelist of allowed fields.
- `src/hooks/useUserProfile.tsx` — React context + hook (`UserProfileProvider`,
  `useUserProfile`) with optimistic PATCH.
- `src/components/onboarding/OnboardingModal.tsx` — 3-step modal (role, sectors, risk +
  firm). Already wired, already saves `onboarding_completed: true`.
- `src/components/onboarding/onboarding-gate.tsx` — mounts modal on dashboard for first-
  session users.
- `src/app/settings/profile/page.tsx` — single-scroll settings page with role chips, sector
  chips, risk options, watchlist tickers.
- Dashboard (`/dashboard`) already has "For You" tab wired to `profile.sectors`,
  `watchlist_tickers`, `risk_appetite`.
- Thesis Board already sets default filter to `recommended` for onboarded users and sorts
  by `sectorMatchesProfile`.
- Morning/evening briefs: `/api/briefing/route.ts` already reshapes `sections` and
  `sector_breakdown` based on `user_profiles.role` (mapped to module) and `sectors`.
  Requires `Authorization: Bearer` header to activate the reshape — frontend pages do
  NOT currently send this token, so personalization on briefs is latent.

### Does NOT exist yet
- `user_events` table usage anywhere in code (verifying in Phase 1 that pre-flight DDL
  landed).
- `theses.user_id` column usage anywhere in frontend or `/api/theses` routes. Spec
  asserts the column was added in pre-flight — will confirm in Phase 1.
- `src/lib/user-profile.ts` (spec calls for creating this central util).
- Behavioral event tracking hooks (`trackEvent`, `updateInferredWeights`).
- 6-step onboarding with live thesis preview (current modal is 3-step).
- `/settings/preferences` page (current is `/settings/profile`).
- `src/lib/thesis-mapper.ts` — mapping is currently duplicated inline in the
  `thesis-board/page.tsx` client and NOT applied in `/api/theses/route.ts` (GET returns raw
  DB rows), NOT applied in `/api/theses/[id]/route.ts` (PATCH returns raw DB data).

## 4. Bug 1 Root Cause (confirmed during recon)

Three different `deriveScore` functions exist, each producing different values for the
same conviction, which is why "95 in list ≠ 82 in detail" happens:

| File                                      | HIGH/BULLISH | BEARISH | Other  | Bonus                 |
|-------------------------------------------|--------------|---------|--------|-----------------------|
| `src/components/thesis/thesis-card.tsx`   | 80           | 30      | 55     | +evidence *5 cap 15   |
| `src/components/thesis/thesis-detail-panel.tsx` | 82    | 28      | 50     | none                  |
| `src/components/thesis/ThesisList.tsx`    | 80           | 30      | 55     | +evidence *5 cap 15   |

All three pass a numeric `score` prop to `<ConvictionRing>`, which renders it inside the
ring. Hard Constraint #11 says **remove** the numeric score — the ring should show only
the conviction label (HIGH/MED/WATCH/BEAR). That is the fix.

## 5. Bug 2 Surface

`/api/theses/route.ts` GET currently does a partial dedup by 40-char title prefix, keeping
the longer title (not the more recent). Spec says change the dedup key to
`${title.trim().toLowerCase()}|${sector}` and keep **most recent** by `generated_at`.
Backend `/api/theses` POST does not check for duplicates before insertion — spec adds a
7-day lookback scoped by `user_id` when present.

## 6. Pipeline Surfaces That Need Personalization (Phase 5 map)

| Surface                           | Current state                                                        | What changes                                        |
|-----------------------------------|----------------------------------------------------------------------|-----------------------------------------------------|
| `/dashboard`                      | Client: for-you/all tabs, filter by sectors/tickers/risk             | Inject `geminiContext` through greeting subtitle; track `morning_brief_opened` equivalent events |
| `/morning-brief`                  | Client: fetches `/api/briefing?type=morning`; NO Authorization header | Send bearer token so briefing route reshapes; track `morning_brief_opened` |
| `/evening-wrap`                   | Same pattern as morning-brief                                        | Same                                                |
| `/trends`                         | Client: hardcoded `allSignals` array, NO personalization today       | Sort/filter by `sectorWeights`; boost watchlist tickers in `description` scan |
| `/thesis-board` GET (`/api/theses`) | Returns raw DB rows, in-memory 40-char prefix dedup                | Use mapThesisRow, dedup by `title|sector`, apply sector weights when `user_id` query param |

## 7. Middleware (already exists)

`src/middleware.ts` is already present — redirects unauthenticated users (except `/`,
`/auth`, `/auth/callback`) to `/auth`. Does NOT currently redirect to `/onboarding`.
**Phase 3 change**: extend, don't create. After getUser(), if onboarding incomplete and not
already on `/onboarding` or `/auth/*`, redirect to `/onboarding`.

## 8. Backend Pipeline Surfaces

- `backend/run.py` — 13-step pipeline. Step 14 slot is explicitly reserved at line 205 with
  comment `# 14:   [RESERVED] (Lucas personalization sprint)`. Adding the new user-aware
  synth step here does NOT require renumbering existing steps.
- `backend/synthesize.py` — `run(brief_type)` returns `{brief_text, brief_addendum_used}`.
  Selects articles via `_select_articles_for_synthesis`, calls Gemini, inserts into
  `briefings` table with `briefing_type="morning"|"evening"`.
- Key addition for Phase 7: add `get_user_profiles()`, `build_user_context_paragraph()`,
  per-user synth loop when `1 <= len(profiles) <= 5`.

## 9. Supabase Schema Notes (from code reading, to be verified in Phase 1)

### `theses` table columns (observed in queries / inserts)
`id, title, conviction, sector, rationale, catalyst, catalyst_note, evidence_chain,
status, source, bear_case, adversarial_score, passed_adversarial, outcome, outcome_notes,
signal_breakdown, supporting_articles, ticker, horizon, check_after, notes, generated_at,
created_at`.
Spec asserts `user_id UUID NULL` was added in pre-flight. To confirm in Phase 1.

### `articles` table columns (observed in ingest.py)
`id, title, summary, url, source, published_at, relevance_score, relevance_reason,
companies, themes, sentiment, sector, industry_verticals, activity_types, deal_type,
primary_company, content_type, content, ingested_at`.

### Reference tables (exist per other queries)
`briefings, pipeline_runs, trend_clusters, weekly_digests, pattern_library,
source_credibility, thesis_notes, user_thesis_states, watchlist_articles, companies,
company_mentions, user_profiles`.

## 10. Key API Routes Identified (all under `src/app/api/`)

`quotes, watchlist-quotes, watchlist/batch, watchlist, market-indices, debug/brief-status,
thesis-detail, thesis-regenerate, theses/notes, theses/patterns, theses/sources, theses,
theses/[id], system-intelligence, memo, ticker-context, user-thesis-states, briefing,
user-profile, company-search, finnhub-news, finnhub-search, news-search,
watchlist-articles, watchlist-notes`.

NOT present: `/api/onboarding/preview-thesis`, `/api/profile/insights` — Phase 3 and
Phase 8 will add these.

## 11. Gold / Design Tokens

`--gold: #C9A84C` (implied from `@import "../styles/tokens.css"`). All new chrome must use
`text-gold`, `bg-gold`, `border-gold`, `var(--gold)` — no hardcoded hex. Existing offenders
(pre-existing, not in scope for this build): `SparklineChart.tsx` uses `#22C55E / #DC2626 /
#6B7280`, `ConvictionRing.tsx` uses `#9CA3AF, #D4A843, #A89060, #DC2626, #3a3530`.

## 12. Plan of Record

Proceeding to Bug Fix 1 → Bug Fix 2 → Phase 1 verify → Phase 2-9 in order per the spec.
Hard constraint: NEVER break an existing pipeline step. NEVER downgrade the system
prompt. NEVER change step numbering 1-13 of `run.py`. ALWAYS soft-fail personalization so
existing UX works for users without a profile.
