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
    "dow":     {"pct": null,    "level": null},   // not in TAPE_SYMBOLS today; key stable for forward-compat
    "russell": {"pct": <float>, "level": <float>}
  }
}
```
Missing symbols serialize to null sub-fields (key never dropped). No tape -> the column is simply not written (NULL).

## Additive-only confirmation
- The `row` dict (briefing_type, headline, summary, market_tone, sections, top_deals, sector_breakdown, created_at) and the `extras` keys are UNCHANGED. Only the insert mechanics were restructured into the ladder, and `market_tape` is added as a new key.
- route.ts untouched and unaffected (additive nullable JSONB surfaced under a new key the frontend ignores).
- Pre-migration safety: if the `market_tape` column does not exist, candidate (a) fails and the insert falls back to candidate (b) = the exact prior behavior, so market_pulse / structured body are still persisted.

## Tests
- New `SerializeTapeSnapshotTests` in `backend/tests/test_market_tape.py`: expected shape from a sample tape; None for None/empty/non-dict; null sub-fields for missing symbols. 3/3 OK.
- Full `test_market_tape`: 37 OK. Offline harness `test_lead_overview_offline`: 37 OK (all prior green). `py_compile` clean. No em-dashes.

## HALT / flags
- REQUIRES MIGRATION: `2026-06-28-briefings-market-tape.sql` is written, UNAPPLIED. Noah applies it; until then the write ladder falls back to extras-only (no regression).
- REQUIRES LUCAS: none edited. Note for Lucas: post-migration, `briefing/route.ts select("*")` will surface `briefing.market_tape` in the API payload (additive, unread by the frontend); no action needed unless you want to exclude it.
- Forward-only: no backfill of historical tape (gen-time tape for past days is unrecoverable; do not fake it).
