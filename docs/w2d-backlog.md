# W2-D backlog

Author: Noah Hanning. Date: 2026-05-06. Status: backlog draft, captured at end of W2-C Phase 1 sprint. Source inputs: PR #187 audit (`docs/w2-c-company-intel-audit-2026-05-04.md`), W2-C design doc (`docs/w2-c-company-intel-redesign-design.md`), and the Phase 1 sprint commits on `noah/w2-c-phase-1`.

This is a prioritized backlog, not a sprint plan. Each item lists the trigger (where it surfaced), proposed scope, and the smallest reasonable PR shape.

## P0 -- carryover blockers from Phase 1

1. **ADR brand alias map for un-tokenized foreign ADRs.** Bulk Finnhub backfill (PR #200) hit 30.3 percent ticker coverage; the long tail of misses includes foreign ADRs whose canonical brand name does not tokenize to the listed ticker. Seed list to bake into the alias table or a static helper: TSMC -> TSM, Samsung -> SSNLF, Celestica -> CLS, SoftBank -> SFTBY, Novo Nordisk -> NVO, Barclays -> BCS, Tencent -> TCEHY, Volkswagen -> VWAGY, SK Hynix -> HXSCY, Tata Consultancy -> TCS. Smallest PR: extend the canonical alias seed file plus a one-time backfill pass that respects the same mention-count gate as PR #201.

2. **Sector backfill execution.** Patch P landed the dry-run script. Live-run is W2-D scope. Confirm the script is idempotent against tonight's data state, then execute.

3. **401 canonicalize-key duplicate cluster merges.** Audit surfaced roughly 457 redundant rows clustering on the same canonical key. Top 25 high-confidence merges land first as a vetted SQL DELETE+UPDATE; the long tail follows once the alias table is the join key for every read.

4. **False-positive ticker scrub.** Roughly 15 mention_count=1 rows have tickers that do not match the row name beyond the X -> XOM case identified by hand. Smallest PR: a script that lists candidates by mention_count<=2 plus ticker mismatch, plus a manual review queue.

## P1 -- observed regressions and gaps

5. **Government-body blocklist enforcement gap.** Federal Reserve Board landed at mention_count=6 despite the existing gov-substring gate. Verify `entity_resolver` runs the gate on every write path (ingest plus web-fallback plus register_entity).

6. **Subsidiary aliasing.** Google Cloud and Waymo should resolve to Alphabet; TikTok should resolve to ByteDance. Land as alias rows once the seed file ships in P0 #1.

7. **Memo regenerates on every close+reopen.** Each open reissues `/api/memo`, eating against the 10/24h rate budget. Smallest fix: per-company in-memory cache keyed on canonical_id, TTL roughly one hour.

8. **Mobile tap-target audit.** Phase 1 sidebar refactor (PR #191) added the breakpoint pattern but two interactive surfaces remain below the 44px iOS minimum: search input height 36, watchlist star 21x21. Bring both to >=44px on viewports below the mobile breakpoint.

9. **Notification panel age window.** Patch S adds a 14-day gate. W2-D revisit: per-event-type max age (price alert <=24h, mention spike <=7d, brief <=14d) once we have telemetry on which event types users dismiss vs act on.

## P2 -- quality and performance

10. **Levenshtein and case-only merges.** Audit's low-confidence cluster (case-only diffs, single-character typos) deferred from P0. Land once the alias table is canonical and the high-confidence merges are clean.

11. **/api/companies cold RTT.** Cold response is roughly 908ms returning 499 records. Smallest PR: server-side pagination (limit+offset) plus an Accept-Encoding gzip header check at the edge.

12. **Esc key handler on /company directory.** Covered by Patch O if it lands tonight; otherwise carry to W2-D.

## Notes on sequencing

- P0 #1 (alias seed) gates P1 #6 (subsidiary aliasing) and feeds the bulk run for P0 #3 (cluster merges).
- P0 #2 (sector backfill) has no upstream dependency; can run first.
- P1 #7 (memo cache) is the cheapest user-visible win; land early in W2-D.
- P2 #11 (RTT) becomes urgent only after the directory page hits a wider audience; defer until launch traffic warrants.
