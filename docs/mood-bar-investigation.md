# Mood Bar — Per-Route Data Path Audit

**Date:** 2026-04-30
**Branch:** `w1/mood-bar-ssot`
**Goal:** find every place the global mood bar reads its `mood` / `headline`
/ `details` from, identify divergences, and define the single source of truth.

---

## Symptoms reproduced 2026-04-30

| Route | Banner copy | Pill |
|---|---|---|
| `/dashboard` | "Markets advancing · VIX 16.9 -10.2% · 10Y 4.39% · S&P +0.66%" | RISK-ON |
| `/morning-brief` | "Today the market is conflicted" | MIXED |
| `/evening-wrap` | (banner reads `briefing.market_tone`) | RISK-OFF |
| `/track-record` | "Markets steady · VIX 14.2 · S&P flat" | NEUTRAL |
| `/notifications` (bell drawer) | "META +9.9%" — disagrees with dashboard's META -8.55% |  |

These five routes were viewed inside the same minute. They should agree on the
banner pill and the live numbers. They don't.

---

## Per-route data path (current state)

| Route | Mood source | Detail strings | Notes |
|---|---|---|---|
| `/dashboard` | `useLiveMood()` | `useLiveMood()` | Correct path. |
| `/morning-brief` | derived from `briefing.market_tone` (a free-form synthesizer string normalised through `normaliseTone()`) | `[]` (empty) | Diverges. Banner reads stale brief tone, not live data. |
| `/evening-wrap` | derived from `briefing.market_tone` | `[]` (empty) | Same divergence as morning brief. |
| `/track-record` | none — `<AppShell pageTitle="Track Record">` with no mood props at all | none | Falls back to `MoodBar`'s default props: hard-coded "Markets steady · VIX 14.2 · S&P flat" and `mood="neutral"`. |
| `/live-feed` | `useLiveMood()` | `useLiveMood()` | OK. |
| `/watchlist` (index) | `useLiveMood()` | `useLiveMood()` | OK. |
| `/watchlist/[identifier]` | `useLiveMood()` | `useLiveMood()` | OK. |
| `/trends` | `useLiveMood()` | `useLiveMood()` | OK. |
| `/deal-flow` | `useLiveMood()` | `useLiveMood()` | OK. |
| `/company` and `/company/[id]` | `useLiveMood()` | `useLiveMood()` | OK. |
| `/thesis-board` | `useLiveMood()` | `useLiveMood()` | OK. |
| `/preview` | `useLiveMood()` | `useLiveMood()` | OK (signed-out preview). |
| `/settings/profile` | `useLiveMood()` | `useLiveMood()` | OK. |
| Notifications dropdown | `watchlist_notifications` rows, written by `backend/watchlist_sync.py` | n/a | `title` / `body` are price snapshots **at the moment the alert fired**. Cooldown is 4h — title can read +9.9% while live quote is -8.55%. |

---

## Root cause summary

Three independent regressions:

1. **Morning Brief and Evening Wrap bypass `useLiveMood`.** Both read
   `briefing.market_tone` (a synthesizer-emitted prose string) and feed it to
   the mood bar as both pill input and headline. This is intentional inside
   the brief body (the "MIXED / Today the market is conflicted" hero card),
   but it should not own the global banner.

2. **Track Record passes no mood props.** The component then renders
   `MoodBar`'s hard-coded defaults (`Markets steady`, `VIX 14.2`, `S&P flat`,
   pill `Neutral`). This is the most embarrassing one because the numbers
   are literally fake.

3. **Notifications use stale snapshots.** `watchlist_sync.py` writes the
   price into the notification title at trigger time. With a 4h cooldown,
   the row can stay around for hours showing a stale quote. The dropdown
   already shows `timeAgo`, but the title looks live.

Even on the routes that *do* call `useLiveMood`, each page mounts its own
copy of the hook and fires its own `/api/market-indices` fetch. The route
caches results for 90s server-side, so the *numbers* end up identical, but
the architecture is one-fetch-per-page-per-mount with no cross-page memo.
That's fine for now (server cache covers it), but the SSOT refactor below
moves that cache into the client so every consumer reads the same in-memory
value.

---

## Single source of truth — implementation

`useLiveMood` is now backed by a module-level cache shared across all
mounts and consumers (see `src/hooks/useLiveMood.ts`). The shape it
returns is unchanged for backwards compatibility (`mood`, `moodHeadline`,
`moodDetails`) but it now also exposes:

```ts
{
  vix, sp500, tenY, bitcoin, oil,
  watchlistQuotes,
  banner: { moodTerm, narrative, pill },
  meta: { lastFetched, sourceUrl, raw },
}
```

- `banner.moodTerm` is the canonical 5-term value (`risk-off` / `risk-on` /
  `neutral` / `mixed` / `watch`). This is what every route now passes to
  `MoodBar`.
- `banner.narrative` is derived deterministically from the same numbers
  that produced `moodTerm` ("Markets advancing", "Risk-Off regime", etc.).
- `meta` is consumed by the debug overlay (mounted on every page via the
  shell, dev-only behind `?debug=mood`).

Cache TTL is 30 s. All mounts share the same in-flight promise so we never
hit the API more than once per 30 s window for the same symbol set, no
matter how many pages or widgets ask for the data.

### Routes touched

- `morning-brief/page.tsx`, `evening-wrap/page.tsx`: now call `useLiveMood()`
  and pass the live banner triple (`mood`, `moodHeadline`, `moodDetails`)
  to `AppShell`. The "Today the market is conflicted" / "RISK-OFF" hero
  cards inside the brief body keep reading `briefing.market_tone` and
  `briefing.market_pulse.sentiment_word` — that vocabulary is intentionally
  separate and stays.
- `track-record/page.tsx`: now calls `useLiveMood()` and passes the live
  triple to `AppShell`. No more hard-coded "VIX 14.2".

### Notifications

- `notification-dropdown.tsx` now surfaces the timestamp in bold mono
  copy directly under the title instead of as a faint footnote, so a
  +9.9% line that fired three hours ago reads "3h ago" prominently and
  the user can tell it's not a live quote. The fix to push live quotes
  into the rendered title would require a backend change and is logged
  separately (see ROADMAP).

### Debug overlay

- `src/components/shell/mood-debug-overlay.tsx` mounts inside `MoodBar`
  and is gated by `process.env.NODE_ENV === "development"` plus the
  `?debug=mood` query param. Shows source URL, last fetched timestamp,
  raw cards, and the derived banner term.

---

## Out of scope (intentionally untouched)

- `synthesize.py`, `ingest.py` — both flagged as "Lucas in flight". Zero
  edits.
- The 5-term canonical vocabulary (`risk-off / risk-on / neutral / mixed
  / watch`).
- Brief-headline prose vocabulary (`sentiment_word` in `synthesize.py`).
- Entity resolution, Track Record grading, brief loading.
