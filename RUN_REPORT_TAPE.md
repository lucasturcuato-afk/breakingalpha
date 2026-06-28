# Persist gen-time tape on the briefings row (v2 Gate 1 prerequisite)

Branch: feat/persist-gen-tape (off post-#431 main, b8f2adef). Draft PR to main. NOT merged. Migration written but NOT applied.

## Recon (read-only, before editing)
- Insert site: `backend/synthesize.py` builds `row` at :3023 and the optional `extras` (market_pulse, lead/context/watch, primary_story_id) at :3044, then inserts at :3055.
- `tape_obj` is a function-local computed once at :2324 (`_maybe_inject_tape_directive`) and is in scope at the insert. It is the dict returned by `market_tape.fetch_tape()`: `{quotes, regime, vix_level}`, where `quotes[sym] = {price, prev, pct}` for the symbols in `TAPE_SYMBOLS` = ^GSPC (S&P), ^IXIC (Nasdaq), ^RUT (Russell), ^VIX. Note: ^DJI (Dow) is NOT in the current fetch set.
- Read contract: `src/app/api/briefing/route.ts:300` does `.from("briefings").select("*")` and spreads the row into the response. A new nullable column therefore surfaces as `briefing.market_tape` in the API payload. This is ADDITIVE and harmless: it is a new key distinct from the existing `briefing.market_pulse` (which route.ts special-cases), and the frontend does not read `market_tape`. route.ts is Lucas-protected and was NOT edited; no read-contract change is required.

## What changed (additive only)
1. MIGRATION (unapplied): `backend/migrations/2026-06-28-briefings-market-tape.sql` adds a nullable `market_tape jsonb` column to `briefings`, with the UNAPPLIED header and a column COMMENT. Nullable so existing rows and any read path are unaffected. Forward-only: past gen-time tape is unrecoverable and is NOT backfilled.
2. SERIALIZER: `market_tape.serialize_tape_snapshot(tape, as_of)` (pure, import-safe). Produces a stable shape from the already-computed `tape_obj`; returns None when there is no tape (weekend / thin / fetch failed) so the caller writes nothing rather than fabricating.
3. WRITE: at the briefings insert, `_tape_snapshot = market_tape.serialize_tape_snapshot(tape_obj, as_of=now)` is serialized into a new `market_tape` key. To avoid regressing market_pulse before the migration is applied, the insert uses an ordered candidate ladder: (a) row + extras + market_tape, (b) row + extras (the existing behavior, preserves market_pulse if the tape column is absent), (c) base row. The first that succeeds wins. No existing column, key, or value is changed.

## Persisted JSONB shape
```
{
  "as_of": "<gen-time ISO8601 UTC>",
  "regime": "risk-on|risk-off|neutral",
  "vix_level": <float>,
  "vix_pct": <float>,
  "indices": {
    "sp500":   {"pct": <float>, "level": <float>},
    "nasdaq":  {"pct": <float>, "level": <float>},
    "dow":     {"pct": <float>, "level": <float>},   // now populated (^DJI in TAPE_SYMBOLS)
    "russell": {"pct": <float>, "level": <float>}
  }
}
```
Missing symbols serialize to null sub-fields (key never dropped). No tape -> the column is simply not written (NULL).

## PART 1: Dow (^DJI) added to TAPE_SYMBOLS
- `backend/market_tape.py`: `^DJI: "Dow Jones Industrial Average"` added to `TAPE_SYMBOLS` between Nasdaq and Russell. It flows through the same symbol-agnostic path: `fetch_tape()` iterates `TAPE_SYMBOLS` by key and calls `fetch_quote(sym)`, which formats the symbol into the Yahoo chart URL and parses via `parse_yahoo_daily`. No special-casing. `serialize_tape_snapshot` already read `^DJI` into `indices.dow`, so it now populates real `{pct, level}`.

### Ripple check (grepped every TAPE_SYMBOLS / fetch_tape consumer)
- `market_tape.fetch_tape` (:270) iterates `for sym in TAPE_SYMBOLS` by KEY. Regime is computed from `quotes["^VIX"]` + `quotes["^GSPC"]` by KEY (not positional). Adding a 5th symbol is inert to regime. No positional indexing anywhere.
- `market_tape.build_tape_directive` (:592) and `synthesize._build_morning_tape_directive` (:1315) both enumerate `TAPE_SYMBOLS.items()`, skip `^VIX`, and emit `"{label}: {pct:+.2f}%"` only when a quote is present (`quotes.get(sym)`). DOW-IN-DIRECTIVE DECISION: Dow IS allowed into the prompt directive (it is real data and matches the grounding rules). This adds a "Dow Jones Industrial Average: +X.XX%" line to the live evening/morning directive when a ^DJI quote is fetched. No test breaks: the directive unit tests in `test_market_tape.py` / `test_morning_tape_grounding.py` use stub tapes with NO `^DJI`, and the loop skips missing symbols, so directive text is unchanged in tests.
- `compute_regime`: takes scalar vix/spx args; parity tests (`regime_parity_cases.json`) feed scalars only. No symbol-set enumeration. Untouched.
- `tape_has_material_move`, `enforce_tape_consistency`, `overview_subject_gate`, `build_tape_driver_names`: read `^GSPC`/`^VIX` by key or operate on caller-supplied dicts. None assume a 4-symbol shape. Untouched.
- FRONTEND: the brief banner/scorecard reads LIVE indices from `/api/market-indices` (e.g. `src/app/preview/page.tsx` uses `indices.spx/.vix/.tnx`), NOT the persisted `market_tape` JSONB. The serialized snapshot is not yet read by any frontend reader, so adding `dow` has zero frontend ripple.
- TESTS: `SerializeTapeSnapshotTests.SAMPLE` now includes a real `^DJI` quote and asserts `indices.dow == {"pct": 0.92, "level": 44100.0}`. A new `test_missing_dow_serializes_to_null_subfields` keeps the missing-symbol case (dow -> null sub-fields). None/empty/non-dict cases unchanged.

## PART 2: Tightened briefings select (route.ts)
- `src/app/api/briefing/route.ts`: replaced `.from("briefings").select("*")` with an explicit single-literal column list. select("*") was NOT load-bearing: no reader does `Object.keys(raw)` / generic key iteration over the briefing row (the only `Object.keys` calls are on the PARSED `sector_breakdown` object, which the route always sets); the only nested/secondary query is `outputs` keyed on `raw.id`, which is in the list.

### Consumed-column trace (read-only recon, definitive)
Only two pages fetch `/api/briefing` and read the returned `briefing` object: `src/app/morning-brief/page.tsx` and `src/app/evening-wrap/page.tsx`. Both alias `const b = data.briefing` and read fields into a typed local state object (the firewall); child components only see that local object, never the raw row. dashboard/print/share/preview do NOT go through this route (dashboard + print + share read the briefings table directly with their own selects; preview reads no briefing).

Quoted accessors (union of both pages):
- `b.id` (morning :305, evening :278); route also uses `raw.id` (:364 outputs query)
- `b.created_at` (morning :316, evening :287); route uses `raw.created_at` (:384 freshness, :425/:471 last_successful_created_at, ordering)
- `b.headline` (morning :306, evening :279)
- `b.summary` (morning :307, evening :280)
- `b.lead_paragraph` (morning :308, evening :281)
- `b.supporting_context` (morning :309, evening :282)
- `b.what_to_watch` (morning :310, evening :283)
- `b.market_tone` (morning :311, evening :284)
- `b.sections` (morning :288/:312, evening :259/:285); route also reads `raw.sections` (:399)
- `b.sector_breakdown` (morning :289/:313, evening :260/:286); route also reads `raw.sector_breakdown` (:400)
- `b.top_deals` (morning :290/:314), morning only; evening does not read it
- `b.market_pulse` (morning :292/:317, evening :262/:288); route also reads `raw.market_pulse` (:408)
- `b.macro_panel` (morning :298/:318, evening :272/:290)
- `b.morning_review` (evening :268/:289), evening only

### Final explicit select (single string literal)
```
id, created_at, headline, summary, lead_paragraph, supporting_context, what_to_watch, market_tone, sections, sector_breakdown, top_deals, market_pulse, macro_panel, morning_review
```
14 columns. Every consumed field plus the route's own id/created_at. EXCLUDES `market_tape` and all other unread internal columns (briefing_date, briefing_type, headwinds, issue_number, market_themes, primary_story_id, tailwinds, thesis, top_stories), confirmed unread by the two consumer pages.

### Ambiguous columns flagged for Noah
- NONE forced-included. One near-miss: morning-brief :315 reads `b.deals || []`, but `deals` is NOT a real briefings column (the row has `top_deals`, not `deals`); it was always `undefined -> []` even under select("*"), so dropping it from the select changes nothing. Not included.

### Confirmation
route.ts now serves exactly (consumed columns) minus (internal columns). The response shape for every consumed field is byte-identical; the only behavioral change is that unread internal columns (notably `market_tape` once the migration is applied) stop being serialized to the client. The `market_tape` passthrough comment in route.ts was updated to reflect the explicit select. select("*") confirmed NOT load-bearing.

### Why this matters now
Pre-migration, the live `briefings` table has NO `market_tape` column, so the API payload never contained it (verified live: `briefing` keys did not include `market_tape`). Once Noah applies the migration, select("*") WOULD have started leaking the internal `market_tape` JSONB to every client. The explicit select prevents that leak ahead of time.

## Additive-only confirmation
- The `row` dict (briefing_type, headline, summary, market_tone, sections, top_deals, sector_breakdown, created_at) and the `extras` keys are UNCHANGED. Only the insert mechanics were restructured into the ladder, and `market_tape` is added as a new key.
- route.ts untouched and unaffected (additive nullable JSONB surfaced under a new key the frontend ignores).
- Pre-migration safety: if the `market_tape` column does not exist, candidate (a) fails and the insert falls back to candidate (b) = the exact prior behavior, so market_pulse / structured body are still persisted.

## Tests
- `SerializeTapeSnapshotTests` (`backend/tests/test_market_tape.py`): expected shape incl. real `indices.dow`; null sub-fields when `^DJI` missing; None for None/empty/non-dict.
- Offline (python3.11): `test_market_tape` + `test_morning_tape_grounding` + `test_lead_overview_offline` = 90 tests OK. `py_compile` clean on `market_tape.py` + `test_market_tape.py`. No em-dashes.
- Frontend gates (worktree, real `npm ci` install): `npx tsc --noEmit` = 0 errors; `npm run lint` = 4 errors / 85 warnings, IDENTICAL with the route change stashed (pre-existing branch floor in unchanged files; route.ts itself has 0 lint issues); `npm run build` = SUCCESS.
  - Note: the build cannot run against a `node_modules` SYMLINK (Turbopack rejects "symlink points out of filesystem root"). tsc + lint work with the symlink; the build required a real install in the worktree.

## Render check (Part 2)
- Two preview targets: `signalera-git-feat-persist-gen-tape-...vercel.app` (302, behind Vercel deployment protection / SSO) and `breakingalpha-git-feat-persi-...vercel.app` (200, reachable).
- Pre-push, the reachable preview's `/api/briefing?type=morning` payload `briefing` keys did NOT include `market_tape` (the column does not exist in the DB yet; migration unapplied). So the render check can confirm "all consumed fields render and `market_tape` is absent" but CANNOT prove active suppression of a present column (none exists to leak until the migration lands).
- Branch pushed; both Vercel previews rebuilt to SUCCESS.

### Render check RESULT: PARTIALLY BLOCKED -> REQUIRES NOAH
- The PROD-data preview (`signalera-git-...`) is behind Vercel SSO Deployment Protection: every route 302-redirects to `vercel.com/sso-api`. Cannot authenticate headlessly. NOT renderable by an agent.
- The reachable preview (`breakingalpha-git-...`, HTTP 200) points at a DIFFERENT / empty (non-prod) Supabase: `/api/briefing?type=morning` and `?type=evening` both return `{"briefing": null, "last_attempt_status": "success"}`, i.e. the documented empty state, even though the PROD DB has valid non-placeholder morning + evening rows with market_pulse (verified via SELECT: morning "Micron Stock Skyrockets...", evening "Micron Soars 15%..."). So the reachable preview cannot exercise a real briefing render.
- What I COULD confirm on the reachable preview (Playwright + curl): the tightened route does NOT crash. `/api/briefing?type=morning` returns 200; the morning-brief page loads and renders the empty state cleanly; the only console errors are unrelated (two 401s from watchlist-brief/user-profile because unauthenticated, and React #418 hydration mismatch, the known pre-existing hydration floor). No error originates from /api/briefing or the select change.
- What I could NOT confirm (BLOCKED): that hero/overview, sections, banner stats, stories, theses all populate from a REAL briefing row through the tightened select; and that `market_tape` is absent from a POPULATED payload (moot today since the column does not exist pre-migration, but unverifiable on a live row regardless).

### REQUIRES NOAH (render check)
Noah must run the render check before merge, on the SIGNALERA preview (the prod-data one) while authenticated:
  1. Open `https://signalera-git-feat-persist-gen-tape-lucasturcuato-afks-projects.vercel.app/morning-brief` and `/evening-wrap` (sign in through Vercel SSO).
  2. Confirm hero/overview, analyst sections, banner stats, top deals/stories, sector breakdown, and (evening) morning_review all render.
  3. In DevTools Network, open `/api/briefing?type=morning` (and evening) and confirm every consumed field is present AND `market_tape` is NOT in the `briefing` payload.
Tests + tsc + lint + build are green, but per the task this Part-2 render check is NOT considered done on tests alone.

## HALT / flags
- REQUIRES MIGRATION: `backend/migrations/2026-06-28-briefings-market-tape.sql` is written, UNAPPLIED (path unchanged this session). Noah applies it; until then the write ladder falls back to extras-only (no regression). After it is applied, the explicit select in route.ts already excludes `market_tape`, so the column is persisted but NOT served to clients.
- REQUIRES NOAH (render check): the Part 2 render check is BLOCKED for an agent (prod preview behind Vercel SSO; reachable preview points at an empty DB). Noah must run it on the signalera preview while authenticated before merge. See "Render check RESULT" above. Tests/tsc/lint/build are green but do not substitute for this check per task instructions.
- route.ts: edited under Noah's one-time authorization for THIS PR only (Part 2). Change is select-scoping + comment updates; no consumed field's response shape changed. No other Lucas-protected file touched.
- Forward-only: no backfill of historical tape (gen-time tape for past days is unrecoverable; do not fake it).
- DOW-IN-DIRECTIVE: Dow IS in the prompt directive (real data; see Part 1 ripple check). If Noah prefers serializer-only, drop `^DJI` from the `index_bits` loops; nothing else needs to change.
