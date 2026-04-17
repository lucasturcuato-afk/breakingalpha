# Personalization Sprint — Build Notes

**Date:** 2026-04-16
**Scope:** End-to-end user personalization for Signalera — onboarding, preference storage,
implicit behavioral learning, propagation through Dashboard / Morning Brief / Evening Wrap /
Trends / Thesis Board, pipeline-side per-user addenda, and a transparency surface so users
can see what the system has learned.

---

## 0. Bug fixes shipped alongside the sprint

- **Unified `mapThesisRow`** — `src/app/api/theses/route.ts` and `src/app/api/theses/[id]/route.ts`
  now use a shared row mapper that returns the existing conviction TEXT enum
  (`HIGH | MEDIUM | WATCH | BEARISH | BULLISH`). Removed the ad-hoc numeric `score` field
  that had leaked in. Hard Constraint #11 respected.
- **7-day user-scoped duplicate check** — the thesis write path now checks for existing
  theses by `(user_id, title, sector)` within a 7-day window instead of a global window,
  so two users can independently hold similar theses without one silently suppressing the
  other.

---

## 1. New migrations (Supabase)

All under `supabase/migrations/`:

| File | Purpose |
|------|---------|
| `20260416_add_theses_user_id.sql` | Adds `user_id uuid references auth.users` to `theses`, plus index + RLS policy for per-user reads. |
| `20260416_create_user_events.sql` | `user_events(id, user_id, event_type, payload jsonb, created_at)` with `auth.uid() = user_id` RLS. |
| `20260416_add_inferred_weights.sql` | Adds `inferred_sector_weights jsonb` and `inferred_weights_updated_at timestamptz` to `user_profiles`. |
| `20260416_create_user_briefings.sql` | Per-user "For You" addendum rows written by the pipeline; read-own RLS only. |

All writes that set these columns soft-fail when the column is missing, so deploying the
app before the migration is run does not break the pipeline or the UI.

---

## 2. New library modules

### `src/lib/user-profile.ts`
Canonical TypeScript surface for the profile. Responsibilities:
- `getUserProfile(supabase, userId)` — reads `user_profiles`, fills defaults, and tolerates
  a missing row (returns a synthetic empty profile).
- `updateInferredWeights(supabase, userId)` — aggregates the last 30 days of `user_events`,
  applies `+0.05` per positive event / `-0.10` per negative event to the prior weights,
  clamps to `[0.3, 2.5]`, and writes `inferred_sector_weights` + `inferred_weights_updated_at`.
- `sectorWeight(profile, sector)` — helper for ranking code: returns the learned weight or
  `1.0` if the sector has no signal.
- `UserEventType` union — the authoritative enum mirrored by `backend/user_synthesis.py`
  and `src/lib/track-event.ts`.

### `src/lib/track-event.ts`
Client-side helper. `trackClientEvent(event_type, payload)` POSTs to `/api/user-events`
fire-and-forget with `keepalive: true`. Silent on failure — tracking must never regress
the UX if the backend is slow.

### `backend/user_synthesis.py`
Python port of the profile helpers + the pipeline step. Generates a short (2-3 sentence)
"For You" addendum per onboarded user by re-reading the briefing that `synthesize.py` just
wrote, so we do **not** re-generate the whole brief per user (one Gemini call per user
instead of O(users) full briefs).

---

## 3. New pages & routes

| Path | Type | Purpose |
|------|------|---------|
| `/onboarding` | Page | 6-step `OnboardingWizard` (role → firm → sectors → watchlist → risk → preview thesis). Gated by `proxy.ts`. |
| `/settings/preferences` | Page | Shows profile snapshot, learned sector weights with a reset button, and the `BehavioralInsights` panel. |
| `/api/onboarding/preview-thesis` | POST | Generates a one-shot preview thesis from the user's declared sectors + risk. |
| `/api/user-events` | POST | Inserts a `user_events` row for the signed-in user. |
| `/api/profile/insights` | GET | Returns profile snapshot, latest weights, 30-day event counts, top boosted/muted sectors, per-sector positive/negative breakdown, event-type histogram, and a narrative string. |

### Proxy (Next.js 16 `proxy.ts`, Node.js runtime)
Extended to gate app pages on `onboarding_completed = true`. New users land on `/onboarding`
after auth; existing users without the column pass through (soft-fail).

---

## 4. Personalization propagation

Every user-facing signal surface now personalizes via learned sector weights:

- **`src/app/api/theses/route.ts`** — GET re-sorts theses by `sectorWeight(profile, sector)` descending
  (stable on ties, falls back to original order). Soft-fails when profile has no signal.
- **`src/app/morning-brief/page.tsx`** and **`src/app/evening-wrap/page.tsx`** — pass a
  `user_addendum=1` query flag so `/api/briefing` can attach the per-user addendum.
- **`src/app/trends/page.tsx`** — sector weights bias the vertical ordering.
- **`src/app/thesis-board/page.tsx`** — uses the personalized GET order and wires event
  tracking on select / quick-action / archive.
- **`src/app/watchlist/page.tsx`** — wires `watchlist_added` / `watchlist_removed` events.
- **`src/components/memo/MemoModal.tsx`** — fires `memo_generated` on successful memo.
- **`src/components/onboarding/OnboardingWizard.tsx`** — fires `onboarding_completed` plus
  one `sector_filter_applied` per declared sector, so day-one ranking already reflects
  stated interests before any implicit signal accumulates.

### Event taxonomy

| Event | Classification | Fired from |
|-------|---------------|-----------|
| `thesis_viewed` | + | Thesis Board select |
| `thesis_approved` | + | Thesis Board status → active/watching |
| `thesis_dismissed` | − | Thesis Board status → archived/rejected, archive button |
| `memo_generated` | + | MemoModal success |
| `morning_brief_opened` | (neutral) | Morning brief page |
| `evening_wrap_opened` | (neutral) | Evening wrap page |
| `pattern_clicked` | + | Trends signal expand |
| `watchlist_added` | + | Watchlist add |
| `watchlist_removed` | − | Watchlist remove |
| `sector_filter_applied` | + | Onboarding seed, sector filter UI |
| `onboarding_completed` | (neutral) | OnboardingWizard submit |

Weight update math is centralized in `updateInferredWeights` — positives `+0.05`, negatives
`-0.10`, clamp `[0.3, 2.5]`, 30-day window.

---

## 5. Backend pipeline changes

`backend/run.py` gained a new step:

```
[14/14] USER-AWARE BRIEF PERSONALIZATION → user_synthesis.run(brief_type)
```

`user_synthesis.py`:
1. Fetches the latest `briefings` row of the requested type (morning/evening).
2. Flattens it into a compact analyst-readable text block.
3. For each `user_profiles` row with `onboarding_completed = true`:
   - Builds a context paragraph from role, firm, sectors, watchlist, risk, and top/bottom
     3 sectors from `inferred_sector_weights`.
   - Calls Gemini 2.5 Flash (temperature 0.3, max 400 tokens, thinking off) with a strict
     system prompt: 2-3 sentences, no bullets, no invented companies, empty string if
     nothing in the brief is relevant.
   - Writes to `user_briefings(user_id, briefing_type, addendum, profile_hash, generated_at)`.

Soft-fails everywhere — missing table, missing column, Gemini error, or Supabase write
failure logs a warning and continues. Pipeline is never blocked by personalization.

---

## 6. Transparency surface

`src/components/profile/BehavioralInsights.tsx` fetches `/api/profile/insights` on mount
and renders:
- Narrative sentence + three headline stats (events, sectors engaged, event types).
- "Leaning in" vs "Cooling on" sector lists (weight ≥ 1.1 or ≤ 0.9).
- 30-day sector activity table with `+positive / -negative / net / weight`.
- Event-mix histogram with human labels.

Wired into `/settings/preferences` below the profile snapshot and learned-weights bar chart.

---

## 7. Verification

- `npx tsc --noEmit` — clean.
- `npm run build` — **succeeded** against Next.js 16.2.2 / Turbopack. All 32 routes
  collected and type-checked, including the new `/api/profile/insights`,
  `/api/onboarding/preview-thesis`, `/api/user-events`, `/onboarding`, and
  `/settings/preferences`.

---

## 8. Design decisions worth remembering

- **One addendum per user, not one brief per user.** Re-reading the already-generated
  briefing keeps Gemini usage linear in users instead of multiplicative, and keeps the
  global brief the single source of truth.
- **Soft-fail everywhere.** Every new code path tolerates missing columns / tables and
  returns sensible defaults, so phased rollouts of the migrations do not break prod.
- **Declared interests seed implicit learning.** Onboarding emits `sector_filter_applied`
  for each declared sector so ranking is meaningful on day one instead of waiting for
  enough implicit clicks.
- **Existing conviction enum preserved.** Personalization touches *ranking*, not *labels*.
  Conviction is still the TEXT enum; no numeric score was introduced.
