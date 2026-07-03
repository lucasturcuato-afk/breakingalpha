# Signalera/Breaking Alpha -- Claude Chat Handoff
**Date:** 2026-07-03 (PT)
**Last session focus:** Web-fallback refinement, materiality ranking (shadow), lead selection overhaul, ingest hardening, XBRL expansion, filter optimization.
**Status:** Main is at HEAD. ~30 PRs merged since 2026-06-16 (2026-06-16 through 2026-07-03). Web-fallback tier system + entity dedup fixes, identity-dedup snapshot, materiality ranking + lead-selection overhaul, tape serialization + persistence, ingest robustness (503 retry, gnews polish, non-English gating), XBRL 20-F/40-F support + SEC CIK population, filter prompt caching (dark), token usage tracking all landed.

---

## Recently Completed (2026-07-03) -- Web-fallback tiers, identity-dedup, lead overhaul, ingest hardening, XBRL expansion

~30 PRs merged (2026-06-16 through 2026-07-03): web-fallback tier system + entity dedup fixes, identity-dedup snapshot (Option B), materiality ranking (shadow mode), lead-selection overhaul + tape refactor, ingest hardening (503 retry, gnews cleanup, non-English gating), XBRL expansion (20-F/40-F support, SEC CIK mint), filter prompt caching (dark flag), cached token count tracking, dashboard relevance fix.

---

## Recently Completed (2026-06-16) -- Track Record reframe to Thesis Tracker (presentation-only)

PR #373: Track Record surface reframed as informational Thesis Tracker. Vocabulary swept (removed call/recommendation/win/loss/grade language), H1 renamed to "Thesis Tracker", verdict chips mapped to neutral display labels (Confirmed->Supported, Invalidated->Challenged, etc.), thesis titles strip leading stance word at render only, evidence columns bucketed by verdict lean, "Most Reliable Sources" section dropped (cron + source_credibility table stay live). Backend, schema, grading pipeline untouched. Helper additions in track-record-live-score.ts: verdictDisplayLabel, neutralizeThesisTitle, verdictLean.

---

## Recently Completed (2026-06-16) -- Lucas feature sprint arc + macro brief panel + Company Intel + grading

**High-level:** 40 commits + 13 feature PRs + 15 fix/chore PRs merged to main (2026-06-03 through 2026-06-16). Key themes: (1) Macro economic data layer + brief panel (BLS Stage 1a + BEA data-only, macro panel slice 1/2), (2) Company Intel operational readiness (Financials tab XBRL, primary_company tagging dark, fallback ArticlesTab for unindexed companies), (3) Grading substrate hardening (service-role client lockdown, window filters, brief_rollup reliability), (4) Track-record redesign (words-first score hiding, methodology transparency, clickable thesis detail pages), (5) Infra + security (tooltips across 6 pages, theses ownership IDOR close, Finnhub key drop from bundle, e2e demotion to advisory). All constraint compliance maintained (zero em-dashes, zero Lucas-protected files rewritten).

**PR arc breakdown:**

- **#362 (2026-06-14):** thesis_grader uses service-role client (Phase 1 lockdown gate coordination).
- **#365–#372 (2026-06-14–16):** Macro panel slice 1 (BLS/BEA data-only) + slice 2 (detection + gated read + full panel). Stage 1a = standing data panel (PCE, core PCE, real GDP); macro panel renders compact/full modes + reads `macro_snapshot.json` from brief; bright-line feature gate.
- **#356 (2026-06-12):** Per-user watchlist section at top of brief (reads `user_profiles.personalized_watchlist_ids`).
- **#354 (2026-06-12):** Backfill tool for companies[]-only primary_company. EXECUTED 2026-06-12 ~21:00 UTC: 10,669 changes applied across 742 companies, confirmed live in the DB (audit log `backfill_audit_20260612T205944Z.jsonl`). Back-catalog fold complete.
- **#352 (2026-06-12):** Primary_company tagging fold into companies[] array (dark, go-forward, mention_count frozen).
- **#322 (2026-06-06):** Financials tab on Company Intel (validated XBRL via `financial_facts_latest` endpoint).
- **#340 (2026-06-07):** Track-record polish — 9-part suite (methodology transparency, words-first redesign, score-presentation clarity, thesis detail pages, credibility at small N, grading fixes). Pages live at `/track-record` + clickable detail pages `/track-record/[thesis_id]`.
- **#337–#342 (2026-06-06–08):** Tooltips (34 across 6 pages) + theses security fixes (require internal key, drop Finnhub NEXT_PUBLIC, IDOR close on PATCH, ownership enforce), landing page Yahoo v8 swap.
- **#348 (2026-06-11):** E2E demotion to advisory (no longer blocks preflight).
- **#345–#350 (2026-06-11):** Top-stories de-arbitration (publish freshness tiebreaker), near-duplicate collapse at render, Date.now() hydration fix.
- **#346 (2026-06-11):** Company Intel read-only two-layer ArticlesTab fallback (dark; users see company-extracted articles even if no IndexNow ping).
- **#328–#331 (2026-06-06):** Memo grading + brief inputs (subject company threading, canonical resolution, tape Close sentiment, Yahoo baseline fixes).
- **#333–#336, #339, #342–#343 (2026-06-07–08):** Misc fixes (landing Yahoo vix+spy+10y, theses security, watchlist_briefs upsert route, top-stories recency window, market route cache).

**PR #354 backfill — DONE (verified 2026-06-16):**
- `--execute` ran 2026-06-12 20:59→21:21 UTC and applied 10,669 of the 10,670 dry-run change set (audit log `backfill_audit_20260612T205944Z.jsonl`). Spot-checks against prod confirm the writes landed; the original change set is fully drained.
- Residual today is ~2,755 articles, all expected drift, NOT a missed backfill: 52 ingested after the run + 2,703 mapping to 264 companies whose `first_seen` is after the run (zero indexed before it). This is the structural consequence of a one-shot backfill plus the go-forward-only #352 fold; the entity index keeps growing, so older articles retroactively become resolvable. Optional follow-up: schedule a periodic re-run if zero-drift is wanted. No action required on the 06-12 execute.

---

## Recently Completed (2026-06-03) -- WD110 tone surface re-scoped to Element 3 + local-dev OAuth diagnosis

**PR #317 — WD110 (re-scoped): tone evidence list + sentiment_reason article detail — MERGED at 1944e42:**
- **Recon finding:** WD110 spec (docs/w2-d/tone-surface-redesign.md, filed 2026-05-18) describes stale current-state premises. ToneReadout + ToneTrendChart redesign with 7D/30D/90D window strip was ALREADY shipped on main; "+0.00 up 0%" delta framing and WD53 hardcoded-green sparkline were ALREADY fixed.
- **Re-scope decision:** Deliver Element 3 only (ToneEvidenceList + ToneArticleDetail). Defer Elements 2 (event-dot timeline) and Element 4 (events/trajectory toggle) as out-of-scope for this session.
- **Shipped:** `getCompanyDetail` now surfaces WD49 `sentiment_reason` (verified 100% populated in prod: 36,536/36,536 rows) as `CompanyDetailArticle.sentimentReason`. New `ToneEvidenceList` component ("Behind this tone" rows under ToneReadout on Price & Tone tab, trailing 7-day window, relevance-desc, cap 5 articles). New `ToneArticleDetail` side panel (desktop) / bottom sheet (mobile), displays sentiment_reason in gold callout, Escape/backdrop close.
- **API shape extension:** `CompanyDetailArticle` return shape extended (additive only, backward-compatible). Surfaces: ToneReadout, ArticleList detail, new sentimentReason field.
- **Heads-up for Lucas:** Schema extension is read-only; his learning-substrate grading (PR #303+) reads this field. No breaking changes.
- **Docs follow-up:** The WD110 spec doc itself describes stale current-state — flag as small docs cleanup task (not blocking).

**Local-dev OAuth diagnosis (no code changes needed):**
- **Symptom:** Logging in from localhost dev servers (e.g., `http://localhost:3000/auth/callback`) fails because GoTrue rejects the non-allowlisted localhost redirect_to and falls back to the dashboard Site URL, which is stored scheme-less as literal "signalera.ai" — browser resolves it as a path on the supabase.co domain instead of HTTPS redirect.
- **Root cause:** Supabase project Auth settings still pinned to old `*.vercel.app` hosts post-domain-migration (2026-05-28). Site URL is scheme-less string "signalera.ai"; Redirect URLs allowlist missing localhost.
- **App code:** Correct as-is. Both initiation (`src/app/auth/page.tsx`) and callback (`src/app/auth/callback/route.ts`) use `window.location.origin` correctly.
- **Fix required (Noah's plate, dashboard-side):** (a) Supabase project → Authentication → URL Configuration. Change Site URL from "signalera.ai" (scheme-less) to `https://signalera.ai` (with scheme). (b) Add to Redirect URLs: `http://localhost:*/auth/callback` (for local dev), keep existing `https://*.vercel.app/**` (for preview deploys).
- **Prod impact:** Production login unaffected (uses `https://signalera.ai` already). Dev-only blocker.

---

## Recently Completed (2026-06-02) -- Filter cost optimization arc (five PRs #305–#310)

**Five-PR arc shipped to main** (all merged 2026-05-31–2026-06-02): PR #305 (dedup-before-filter, ~77% fewer filter calls), PR #306 (disabled thinking on filter call, ~$10→$5/run estimate), PR #307 (thread-safe usage metering with `[filter:usage]` log line per run), PR #308 (outlet blocklist strip from company_mentions), PR #309 (SEC bypass: deterministic 8-K/10-Q routing around Gemini), PR #310 (V3 rubric + Flash-Lite swap on filter only). **INGEST GATE:** `if result and result.get("relevant") and result.get("relevance_score", 0) >= 6` — article must independently pass both gates. **Flash-Lite scope:** FILTER_MODEL only (line ~44 backend/ingest.py); all 14 other Gemini call sites stay on gemini-2.5-flash. **VALIDATION PLAN for first real run:** meter delta should reach ~$1.5/run; check #307 log `[filter:usage]`; run-over-run backstop on ingest count + relevance_score distribution; SEC count unchanged via bypass; brief headline + pool quality intact.

---

## Recently Completed (2026-05-19) -- W2-D all PRs merged + tone surface spec

PR #247 through #257 all merged to main as of 2026-05-19. W2-D parallel sprint completions: WD87 (orphan cleanup), WD81/WD82/WD84/WD85/WD86 (chrome polish), WD63/WD59/WD49 (classifier audit), WD72/WD61/WD62/WD64/WD03/WD06/WD26/WD60/WD71/WD69/WD83 (entity recon), WD70 (BriefTab regenerate), WD89/WD66/WD91 (visual smoke). Additional merges: WD74 (relevance_reason surface), WD93 (Trend tab rename to "Price & Tone"), WD95 (decouple tab state from RSC refetch), WD110 (tone surface redesign spec), WD92 (sector backfill + cron). All constraint compliance maintained (zero em-dashes, zero Lucas-protected file modifications except PR #251 precedent, zero structured output reintroduction).

---

## Recently Completed (2026-05-11) -- W2-C Phase 1 ship

**PR #197 merged to main** (squash commit `22cda0c`) with integration branch `noah/w2-c-phase-1` deleted post-merge. Both Vercel deployments (breakingalpha + signalera) reported SUCCESS within 90s. Phase 1 content now live: C1c freeform brief, C1e ArticlesTab (6-column table + density restoration), C1f completion badges + overrides, C1g tab label strip.

---

## Recently Completed (2026-05-11) -- W2-D parallel sprint (6 threads, all returned within ~35 min) -- NOW ALL MERGED AS OF 2026-05-19

Dispatch start `2026-05-11T21:43:57Z`. All 6 background agents returned with deliverables before 8h hard cap. All 6 PRs initially DRAFT, all now MERGED to main as of 2026-05-19. Lucas-protected files untouched except `/api/memo/route.ts` (Thread F exception). Zero em-dashes across all new content.

### Sprint summary

| Thread | Scope (WD coverage) | Branch | Type | Status | Draft PR | LOC delta |
|---|---|---|---|---|---|---|
| A | WD81 WD82 WD84 WD85 WD86 (chrome polish) | `noah/w2-d-chrome-polish` | code | COMPLETED | [#249](https://github.com/lucasturcuato-afk/breakingalpha/pull/249) | +158 / -60 (10 files) |
| B | WD87 (orphan cleanup) | `noah/w2-d-orphan-cleanup` | code | COMPLETED | [#247](https://github.com/lucasturcuato-afk/breakingalpha/pull/247) | +0 / -564 (4 files) |
| C | WD72 WD61 WD62 WD64 WD03 WD06 WD26 WD60 WD71 WD69 WD83 (entity + process) | `noah/w2-d-recon-entity` | doc | COMPLETED | [#250](https://github.com/lucasturcuato-afk/breakingalpha/pull/250) | +812 / -0 (2 findings docs) |
| D | WD63 WD59 WD49 (classifier + summary + sentiment) | `noah/w2-d-recon-classifier` | doc | COMPLETED | [#252](https://github.com/lucasturcuato-afk/breakingalpha/pull/252) | +396 / -0 (1 findings doc) |
| E | WD89 WD66 WD91 (visual smoke, auth-blocked) | `noah/w2-d-recon-smoke` | doc | COMPLETED-PARTIAL | [#248](https://github.com/lucasturcuato-afk/breakingalpha/pull/248) | +298 / -0 (5 files) |
| F | WD70 (BriefTab regenerate + 3/day quota) | `noah/w2-d-wd70-regenerate` | code + migration | COMPLETED | [#251](https://github.com/lucasturcuato-afk/breakingalpha/pull/251) | +296 / -13 (4 files) |

**Aggregate**: +1,960 LOC / -637 LOC across 26 files. All 6 PRs merged to main 2026-05-19.

### Halts encountered

None. Every thread completed inside-scope. Thread E's auth-wall was anticipated and gracefully handled via code-read substitutes for WD66/WD91.

### Merge notes -- all complete as of 2026-05-19

All 6 W2-D PRs merged to main in sequence (2026-05-18 to 2026-05-19). Noah completed:
1. **PR #251 (WD70 Regenerate)** -- merged with migration executed in Supabase
2. **PR #249 (Chrome polish)** -- merged
3. **PR #247 (Orphan cleanup)** -- merged
4. **PR #250 (Entity + process recon)** -- merged with findings docs now on main
5. **PR #248 (Visual smoke partial)** -- merged with findings docs now on main
6. **PR #252 (Classifier audit)** -- merged with audit doc on main. WD-number renumbering handled post-merge (WD64-WD75 from audit backfilled as WD92-WD109).

### Cross-thread converging findings

- **Undefined CSS tokens `--gold-deep` / `--gold-faint`** independently surfaced by:
  - Thread A WD-candidate-E: broad scope (9+ silent-fall-through references in `CompanyDetailHeader`, `CompanyAliasRibbon`, `EmptyState`, `EmptyStateCTA`, `WebFallbackBanner`)
  - Thread E WD91-B: narrow scope (EmptyStateCTA contrast)
  - **Recommendation**: define at root in `src/styles/tokens.css`; closes both findings in one pass.
- **Worktree `next build` Turbopack-root failure** flagged by Threads A, B, F. Build verification gate effectively non-functional in worktree mode. Configure `turbopack.root` so future code-thread sprints can run full build verification.

### Highest-leverage / lowest-effort follow-up (from Thread D)

Surface existing `relevance_reason` column in the ArticlesRow expand-row instead of the noisy RSS-derived `summary`. The LLM rationale already exists in DB and is currently unused by any UI surface. Single-file UI change, no schema work.

### WD-number collision warning

`docs/w2-d-backlog.md` currently runs WD30 through WD91. Thread D's findings doc proposed WD64 through WD75 for new entries, which collides with existing entries. **Noah must renumber Thread D's proposals on intake** (e.g. WD92 onward, or interleave with semantic grouping). Other threads correctly used "WD-A through WD-L" placeholder labels.

### New WD candidates discovered (consolidated, deduplicated)

**Chrome / UI tokens / UX polish** (5, Thread A):
- BriefTab "AI Brief" card header strip component (~30 LOC)
- ArticlesTable "Recent coverage" header strip (~35 LOC)
- BriefTab cache-checking flash hardening
- Surface alt-key glyph hint on CompanyDetailTabs (currently hidden)
- **Define `--gold-deep` / `--gold-faint` tokens at root** (cross-cuts WD91-B)

**Empty-state surface (Thread E breakdown of WD91)** (4):
- WD91-A (P2): brand string fix at `EmptyState.tsx:93`
- WD91-B (P1): undefined gold tokens (subsumed by chrome item above)
- WD91-C (P3): close as-designed (Search Directory Link works)
- WD91-D (P2): rescope to `/watchlist`, Lucas-coordinate

**Auth / visual-smoke infra** (4, Thread E):
- **P0: seed `auth-state.json` or wire Playwright login automation** -- blocker for all future visual-smoke threads
- P1: re-run 180-surface sweep post-seed (deferred WD89)
- P3: production landing CTA renders literal em-dash glyph despite ASCII-only convention
- P2: `/company` directory exposes real mention counts unauthenticated -- confirm intended

**Entity resolution + ingestion** (12, Thread C):
- Name normalization
- `primary_company` UUID FK migration
- `articles.companies` link table
- pg_trgm install + fuzzy ingest hook
- `validateExtractedCompanyName` reject list (geos / agencies / parentheticals)
- One-shot UPDATE for NULL fragment-row tickers
- ExxonMobil / JPMorgan / Tencent HARD_TICKER_OVERRIDES + canonicalize aliases
- Null-ticker-backfill cron
- Segment-as-company blocklist + parent rollup (AWS, Facebook, Instagram, TikTok)
- Index baseline (`companies(lower(name))` unique + `companies(ticker)` partial)
- aliasResolver sync on every CANONICAL/HARD_TICKER_OVERRIDE addition
- Upstream trace on token-stem fragments (Pillar / Cove / AMI / MMV / Uni / Mach / NS / Rocket)

**Classifier / pipeline** (12, Thread D, requires renumber):
- P0: Earnings prompt tightening at `backend/ingest.py:215`
- P0: Sentiment frame definition (event-vs-reaction) at `backend/ingest.py:214` -- resolves WD49 root cause [SHIPPED 2026-05-18 via commit `6f9c91d` `feat(wd49): add sentiment_reason field with event-frame prompt`]
- P2: Reintroduce Regulation deal_type bucket + backfill migration
- P1: `strip_html` prefix peeling for PRNewswire / Investing.com / wire datelines
- P1: SEC summary backfill from `content` column (61 SEC rows have only filing-metadata as summary)
- P1: `primary_company` hallucination guard tightening
- P3: Low-quality source blocklist (Naturalnews, Globalresearch, Crypto Briefing, Futurism, Om.co, Bitcoinfoundation.org)
- P2: JV deal_type disambiguator (Funding vs M&A vs Other)
- P2: IPO clause excludes ETF launches and SPAC over-allotments
- P3: UI-side sentiment label sweep (story-card, feed-row, brief-pdf)
- **HIGHEST-LEVERAGE / LOWEST-EFFORT**: surface existing `relevance_reason` in ArticlesRow expand-row [SHIPPED 2026-05-18 as WD74 / PR #253]
- (Optional larger) Add a true per-article synthesized lede prompt

**Infra / DX** (2, Thread F):
- Configure `turbopack.root` for worktree builds (so future thread-F-style sprints can run full build verification)
- `MEMO_REGENERATIONS_PER_DAY` triple-source-of-truth -- hoist to `src/lib/quotas.ts` to prevent drift

### Critical pipeline finding (reframes WD59)

`articles.summary` is **NOT** LLM-generated. It is the RSS feed `description` HTML-stripped and capped at 500 chars in `backend/ingest.py:349-361, 466, 512, 543`. There is no synthesis prompt to diff for article summaries. WD59 should be reframed from "summary-prompt-tuning audit" to "feed/normalization audit."

### Constraint compliance

All 6 threads confirmed:
- Zero merges to main
- Zero SQL writes (Thread C + D used read-only Supabase MCP)
- Zero `buildMemoSystemPrompt` changes
- Zero em-dashes in new content
- Zero structured-output reintroduction
- Lucas-protected files: untouched except `/api/memo/route.ts` (Thread F exception per protocol override)
- WD88 (Lucas-protected file review) not addressed -- requires Lucas coordination

### Sprint artifacts

- Status log: `docs/w2-d/sprint-status.md` (this commit, on main)
- Findings docs (on respective PR branches, NOT on main):
  - `docs/w2-d/entity-resolution-audit.md` (PR #250, branch `noah/w2-d-recon-entity`)
  - `docs/w2-d/process-and-spec-recon.md` (PR #250)
  - `docs/w2-d/classifier-summary-audit.md` (PR #252, branch `noah/w2-d-recon-classifier`)
  - `docs/w2-d/visual-smoke-audit.md` (PR #248, branch `noah/w2-d-recon-smoke`)

To inspect a findings doc without checking out the branch: `git fetch origin && git show origin/<branch>:docs/w2-d/<file>.md`

---

## 2026-05-10 overnight -- parallel agent work (Overnight C1c/C1e session) -- COMPLETED

Merge cascade concluded on 2026-05-11 morning. PR #246 (C1f) -> C1e -> PR #245 (C1g) -> C1e -> PR #244 (C1e+C1f+C1g) -> C1c -> PR #243 (C1c+everything) -> integration -> squash PR #197 to main at `22cda0c`. SQL gate (18 tickers + Alphabet 7-dup) executed via dashboard. All 9 cascade steps complete; integration smoke and main deployment both passed.

### PR state summary (final state post-cascade)

| PR | State | Tip | Key fact |
|---|---|---|---|
| #241 (C1a) | CLOSED | n/a | superseded comment posted; structured-output path abandoned |
| #242 (C1b) | CLOSED | n/a | superseded comment posted; density-floor port unnecessary post-C1c |
| #243 (C1c) | MERGED | `debec11` | Squashed to integration, absorbed C1f + C1g in cascade sequence. |
| #244 (C1e+C1f+C1g) | MERGED | `debec11` | Squashed to C1c/integration as part of cascade. ArticlesTab + overrides + label strip. |
| #245 (C1g) | MERGED | `ebe7197` | Tab label strip PR, squashed to C1e. |
| #246 (C1f) | MERGED | `23bc58e` | Density restoration PR, squashed to C1e. |
| #197 | MERGED | `22cda0c` | Integration -> main. Squash-merged on 2026-05-11. |

### Phase outcomes

**Phase 1 (CSS fix):** LANDED on PR #244 as commit `5fbe05b`. Single file `src/components/company/ArticlesTable.tsx`, 3 LOC: `overflow-hidden -> overflow-x-auto` on wrapper, `table-fixed + min-w-[700px]` on table, `min-w-[200px]` on Headline `<th>`. Restores 6-column visibility at typical desktop viewports; horizontal scrollbar fallback at narrow viewports.

**Phase 2 (empty-state triage):** COMPLETE -- no C1c regressions among the 5 known bugs. Classifications:
- (a) Brand "Breaking Alpha" -> (iii) NEVER WORKED. Introduced in PR-E1 #238 by Noah on 2026-05-07; no "Signalera" string anywhere in src/.
- (b) "Add to watchlist" contrast -> (iii) NEVER WORKED. EmptyStateCTA uses undefined CSS tokens `--gold-deep`/`--gold-faint`/`--gold-border-deep`; falls through to cream-on-cream-hi.
- (c) "Search directory" onClick -> (iii). Element is `<Link href="/company">`, no onClick needed. If inline-search was expected, that flow was never built (see WD40).
- (d) Ticker controlled-input blur -> (i) PRE-EXISTING + Lucas-protected. `WatchlistAddInput.tsx` byte-identical to main.
- (e) Web-fallback empty-state -> (iii) per C9 mandate (out of scope this session).
All five filed as WD41 (consolidated) + WD40 (separate web-fallback search scope).

**Phase 3 (regression fixes):** SKIPPED per F6. Zero eligible (ii) C1c-regressions surfaced in Phase 2. PR-C1f NOT opened.

**Phase 4 (WD50 audit):** COMPLETE -- 16 surfaces static-analyzed. 0 C1c regressions. 2 pre-existing prod-main bugs (sources top-12 cap; header NASDAQ subtitle). 5 design drift items (ArticlesTab DR-A1..A4 under WD35 family + tab keyboard hint omits `[/]`). 6 ambiguous items filed as WD51-WD58. Phase 7 NOT triggered. NO ship-blocker alerts for #197.

**Phase 5 (HANDOFF.md):** This section. Committed to `noah/pr-c1e-articles-table-density` per overnight P5.1.

**Phase 6 (closures):** PR #241 + #242 closed with pre-authorized supersession comments. 'superseded' label not applied (label availability not verified).

### W2-D backlog additions (WD30-WD41, WD51-WD58)

Filed to `docs/w2-d-backlog.md` on the C1e branch (NOT main). 20 entries total. Highlights:
- **WD30-WD33, WD41**: tab keyboard shortcuts, tab chrome polish, BriefTab download/export, empty-state bug consolidation
- **WD34, WD35**: BriefTab TLDR gold-faint block + 21-item chrome polish batch from C1b/C1c drift
- **WD36-WD37**: stale JSDoc cleanup + orphaned legacy components (verified zero importers)
- **WD38**: Lucas-protected file review post-#197
- **WD39**: pre-#197 manual visual smoke audit (Noah's recommended pre-ship action)
- **WD40**: user-triggered web-fallback search on unindexed empty-state -- product scope decision required
- **WD51-WD58**: Phase 4 audit findings (themes substring match, duplicate Sources h3, sparkline ink hardcoded green, KPI events-today label mismatch, header NASDAQ hardcode, alias chips no-onClick, no distinct 404, keyboard hint omits brackets)

**Numbering note**: WD30-WD41 + WD51-WD58 used here on the C1e branch. Main branch has its own WD30-WD33 + WD34-WD35 + WD40-WD45 + WD50 from prior sessions. There will be a merge conflict at WD30 onward when integration eventually merges to main. Resolve at PR #197 merge time.

### Open product questions for Noah

1. **WD40 web-fallback scope:** wire user-triggered search on unindexed empty-state. Is this Phase 1 (pre-#197 ship) or Phase 2 (post-ship)? Backend infrastructure exists per WD11-WD16.
2. **WD30 tab keyboard shortcuts:** Fn labels imply Alt+number shortcuts. Implement handlers (~30 LOC) OR strip Fn labels from tabs. Either direction is acceptable; pick before #197.
3. **WD38 Lucas-protected file review:** Phase 1 architectural shifts mean some protections may no longer be load-bearing. MemoModal.tsx is largely superseded by BriefTab for company memos. Worth a conversation with Lucas before final ship.
4. **Tab system architectural drift:** F7 = Transcripts on live codebase but spec said Insider; F8 = Insider but spec said Options; F9 = Comps but spec said Peers. PR-A2 locked the live labels. Document deviations in #197 PR body.
5. **WD33 BriefTab download/export:** prod MemoModal had it; was not ported to BriefTab during C1a. Adds Phase 1 polish if it's a launch blocker. Otherwise file as Phase 2.

### Cascade and ship sequence (completed 2026-05-11 morning)

1. Squashed PR #246 (C1f) and PR #245 (C1g) into C1e branch.
2. Squashed combined C1e+C1f+C1g (PR #244) into C1c branch (PR #243).
3. Squashed PR #243 (C1c with all above) into integration.
4. Executed SQL gate: 18 ticker UPDATEs + Alphabet 7-dup merge via Supabase dashboard.
5. Integration smoke passed (HTTP 200 on test routes).
6. Resolved main-to-integration conflict via backlog reconciliation (WD30-WD91 numbering).
7. Squashed PR #197 integration -> main at commit `22cda0c`.
8. Vercel deployment: breakingalpha SUCCESS, signalera SUCCESS (both within 90s).
9. Deleted `noah/w2-c-phase-1` branch post-merge.

### Files modified this session (on noah/pr-c1e-articles-table-density)

- `src/components/company/ArticlesTable.tsx` (Phase 1 CSS fix, 3 LOC)
- `docs/w2-d-backlog.md` (WD30-WD41 + WD51-WD58 = 20 entries, 49 total)
- `docs/HANDOFF.md` (this section)

### Files NOT modified

- No application logic touched
- Lucas-protected files (WatchlistAddInput.tsx, MemoModal.tsx, watchlist-utils.ts, trends/page.tsx, briefing/route.ts) -- read only
- `buildMemoSystemPrompt` in company-intel.ts -- byte-identical to main
- No structured-output infrastructure reintroduced
- Zero new em-dashes (3 pre-existing verbatim revert remain)
- main, w2-c-phase-1 branches not pushed to from C1e work

### PRs status (post-cascade)

PR #241 and #242 closed during 2026-05-10 phase. PR #243, #244, #245, #246 merged via cascade. PR #197 merged to main and deleted branch post-merge.

### Cascade commits

- PR #246 (C1f) squashed to C1e at `23bc58e`
- PR #245 (C1g) squashed to C1e at `ebe7197`
- PR #244 (C1e+C1f+C1g) squashed to C1c at `debec11`
- PR #243 (C1c+all above) squashed to integration at `8ac706b`
- Integration tip post-cascade: `e6d8f1e` (conflict resolution for main backlog reconciliation)
- PR #197 squashed to main at `22cda0c`

---

## Recently Completed (2026-05-06) -- W2-C Phase 1 sprint (merged 2026-05-11)

PR #197 collected all of the work below onto integration branch `noah/w2-c-phase-1`. Merged to main on 2026-05-11 (commit `22cda0c`) after SQL pre-ship gates (18 ticker UPDATEs + Alphabet 7-dup merge) completed successfully.

Sprint commits, in merge order to integration:

- **PR #198** -- web-fallback ticker population during canonical creation. `register_entity` miss-branch now does a best-effort Finnhub `/api/v1/search` call before insert.
- **PR #200** -- one-time bulk ticker backfill via Finnhub `/search`. Reference commit; ran in prod, inserted 881 of 2907 rows (30.3 percent coverage). Long-tail misses are mostly foreign ADRs (see W2-D backlog item 1).
- **PR #201** -- unified canonical matching rules + retry chain + mention-count gate. Aligns Python helper, bulk backfill, web-fallback, and TS lazy lookup on one algorithm. Closes the foreign-ticker pollution and Warner Bros. Discovery bugs.
- **PR #194** -- one-time alias backfill script. Inserted 2882 of 2902 rows; 1:1 with companies post-run.
- **PR #195** -- W2-A read-path PR. Adds `alias_count` to `GET /api/companies` via PostgREST relationship-count subquery; adds typo-redirect via `normalizeLookupKey` on zero-result queries.
- **PR #196** -- stock chart on company detail page (Phase 1.5). Pure-SVG chart, range selector, hover crosshair; new `/api/stock-chart` Yahoo proxy.
- **PR #203** (PR D) -- skip role-block prepend for company memo types. One-line ternary in `src/app/api/memo/route.ts` so company / company-web prompts own the section structure end to end.
- **PR #204** (PR E) -- center detail page content + widen to 960px. Three lines in `company-detail-client.tsx`.
- **PR #205** (PR F) -- directory dedup backfills ticker/sector from sibling rows. Single-file change in `src/app/company/page.tsx` so the canonical card inherits non-null fields from cluster siblings.
- **PR #199** -- lazy ticker lookup at detail-page request time + integration merge + mention_count threading. Falls through to Finnhub once when ticker is NULL, persists fire-and-forget; ready for self-merge to integration.
- **PR #202** -- chart 1D percent uses `chartPreviousClose` anchor; headline price prefers `regularMarketPrice` (Bug 3 fix).

Earlier in the sprint window:

- **PR #191** -- sidebar refactor (Phase 1 surface 1).
- **PR #192** -- `CompanyIntelMemoModal` fork (Phase 1 surface 2). Shared `MemoModal` left untouched per section 8 question 3 of the W2-C design doc.
- **PR #193** -- directory page redesign (Phase 1 surface 3). Replaces 3-column card grid with the 28-row dense table.

### Architecture decisions banked

- **Pure-SVG charts.** No Recharts. Yahoo `/v8/finance/chart` is the data source; `chartPreviousClose` anchors the 1D percent (PR #202).
- **Edge cache via headers.** `/api/stock-chart` does no request-time DB calls; data is cached at the edge.
- **Ticker coverage strategy.** Resolution chain is name-as-is -> suffix-strip -> period-strip -> first-2-tokens, gated by `mention_count >= 2` (Amendment 3). The same rule fires from bulk backfill, web-fallback, and lazy lookup.
- **Mention-count gate (Amendment 3).** Shared between PR #200, PR #198, PR #201, and PR #199. One algorithm, three call sites.
- **Memo prompt structure.** Company prompts own complete section structure top to bottom; the role-block prepend only applies to deal / thesis / brief / article paths (PR #203).

### Overnight patch sprint queued

Per `.session-artifacts/overnight/SHARED_INSTRUCTIONS.md`. Status as of doc write:

- Patches I (PR #206 search read-path) and S (PR #207 notification 14-day gate) opened against integration.
- Patch P (sector backfill script) in progress.
- Patches J, K, L, M, N1, N2, O queued; status not yet logged.

### Process notes (lessons from this sprint)

- **Parallel-write hazard.** Two patches that share a file produce a Git race. Mitigation: every write subagent runs in its own isolated worktree under `.claude/worktrees/`.
- **Session-unique tmp filenames.** Commit-message and PR-body tmp files use the session UUID prefix (`overnight-2026-05-06-3a7b9c-patch-<letter>-...`) so two agents never collide on `/tmp/foo`.
- **Onboarding-bypass PATCH for test users.** Without the `user_profiles` PATCH after `auth/v1/admin/users` POST, `/company/*` redirects to `/onboarding`. Codified in shared instructions.
- **Playwright collision handling.** Single shared MCP browser; on "browser busy", retry every 30s up to 3 minutes, then fall back to curl/REST and document the symptom.

---

## 2026-05-08 -- Pipeline run #98 fix (from main)

Diagnostic + fix for the morning pipeline run #98 6h+ hang. Ran in a separate worktree (`noah/diagnose-pipeline-timeout`) so it did not collide with the W2-C Phase 4/5/6 session. PR #239 OPEN ready-for-review, base=main. Pipeline fix shipped to PR #239. 4 layered changes (timeouts + UA, chunked filter, response_schema, drop batch path) brought duration from 6h+ (run #98 cancelled) -> 87 -> 36 -> 30 -> 20.7 min across 4 smoke tests. All 10 success criteria pass on smoke #4. W2-D items WD40-WD45 filed. Full detail in "Recently Completed (2026-05-08)" section below.

---

## Recently Completed (2026-05-08) -- Pipeline run #98 fix

**Branch:** `noah/diagnose-pipeline-timeout` (off origin/main, separate from W2-C session). PR #239 ready-for-review.

**Files touched:**
- `backend/ingest.py` (+~270 LOC, -~210): bounded RSS fetch with UA + 20s timeout, dead-feed cleanup (Reuters x3 + Pitchbook removed), Gemini timeouts via ThreadPoolExecutor, pydantic FilterDecision schema, per-article filter with parallel workers (5) and retry-once, structured logging contract
- `backend/run.py` (+~130 LOC): per-step elapsed-time prints across all 16 steps + POST steps
- `.github/workflows/schedule.yml` (+1 LOC): timeout-minutes 90 on Run pipeline step
- `.claude/worktrees/diagnose-pipeline-timeout/DIAGNOSIS.md` (new, ~600 LOC): full diagnostic record

**Smoke test progression (all 4 documented in DIAGNOSIS.md sections 14-19):**

| run | duration | filter step | failure rate |
|---|---|---|---|
| Run #98 (cancelled) | 6h+ | hung | unknown |
| Smoke #1 (timeouts + UA) | 87 min | 70 min | 100% serial fallback |
| Smoke #2 (chunked + parallel) | 36 min | 27.5 min | 12/13 chunks fell back |
| Smoke #3 (response_schema) | 30 min | 21.5 min | 12/13 chunks fell back, 5/600 per-article errors |
| Smoke #4 (per-article only) | 20.7 min | 9.1 min | 3/615 = 0.49% per-article |

**Key finding:** The "duration creep" from 27 min (Apr 28) to 76 min (May 6-7) was NOT gradual deterioration. Every recent successful run was silently riding a serial per-article fallback path because the single-batch Gemini filter call was emitting malformed JSON for hundreds of articles. The 76 min was 70 min of fallback + 6 min of legitimate work. This PR removes the broken batch path entirely and runs per-article + parallel workers, which restores Apr-28 baseline and beats it.

**What did NOT cause run #98:**
- Memo `maxOutputTokens` bump (commit 1f3a4b3, 600 -> 2400) was suspected but is in the Next.js memo route, not pipeline code path. Falsified.
- PR #201 / #209 retry chain in `finnhub_helper.py` was suspected but those PRs are on feature branches and not in `origin/main`. Falsified.

**Production state at end of session:**
- PR #239 OPEN, ready-for-review, base=main, head=noah/diagnose-pipeline-timeout, NOT auto-merged per safety rule
- cron-job.org morning trigger STILL paused, awaits Noah re-enable AFTER merge
- Today's 6 AM PT cron (run 25556935932) ran on bugged main code at 1h25m, succeeded with degraded duration. Brief landed for May 8 morning before the smoke tests overwrote it
- Smoke #4 brief is the current /morning-brief on prod: "Trump's Tariff Setback Weakens China Trade Talk Leverage Ahead of Beijing Visit", 1140 char summary, 8 SEC 8-K + 8 SEC 10-Q stored

**Next actions for Noah:**
1. Read DIAGNOSIS.md sections 14-19 for full evidence trail
2. Read the smoke #4 brief on /morning-brief (or query `briefings WHERE briefing_date='2026-05-08'`) and confirm content quality
3. Squash-merge PR #239 to main
4. Re-enable cron-job.org morning trigger
5. Tomorrow's 6 AM PT cron is the production verification

**Doc commits in this PR (`noah/w2d-pipeline-followups` -> main, separate from PR #239):**
- This HANDOFF.md update
- `docs/w2-d-backlog.md` adds WD40-WD45 (5 follow-up items)

---

## Previous session (2026-05-07) -- W2-C Phase 1 Phases 4/5/6
**Last session focus:** W2-C Phase 1 detail-page redesign: Phases 4, 5, and 6 fan-out + sequential merge to integration branch `noah/w2-c-phase-1`. 18 PRs landed across the 3 phases (PR #221 through PR #238). PR #197 now MERGEABLE and ready for self-merge to main pending HALT 8 sign-off.
**Status:** Phase 4/5/6 complete; integration branch contains the full new tab system + observability substrate + 4 state variants. PR #197 OPEN, MERGEABLE, base=main, head=noah/w2-c-phase-1. HALT 8 surfaced -- awaiting user self-merge in the morning.

---

## Recently Completed (2026-05-07) -- W2-C Phase 1 Phases 4/5/6

PR #197 collects all of the work below. 18 PRs squash-merged to integration via locked-order dispatches. Each PR followed the recon -> implement -> self-review pattern in isolated worktrees.

**Phase 4 (8 PRs, dispatched parallel after HALT 4 acceptance test passed):**

- **PR #221** -- PR-B0 alias canonical-rollup query-time synthesizer (`8a99f3f` was in main, this is the integration sibling). `src/lib/data-access/aliasResolver.ts` (137 LOC) + `getCompanyDetail.ts` refactor. Spec called for `is_canonical` + `created_at` columns; live aliases schema has neither. Implementer pivoted to recon-recommended tiebreaker hierarchy `mention_count DESC -> last_updated DESC -> first_seen ASC -> id ASC`. Filed WD30 backlog for editorial-pinned canonical preference.
- **PR #226** -- PR-D2 recordOutput SDK + `output_log_v0_stub` migration + `/api/memo` route after() integration. Pattern A (post-response after() fire-and-forget). 3 files / +152 LOC. Migration applied manually by Noah; HALT 4 acceptance test passed (NVIDIA memo wrote correct row: `output_type="memo"`, `source_table="companies"`, `latency_ms=3757`, `prompt_inputs` + `metadata` JSONB valid). Stub naming preserves Lucas's eventual canonical Step 3 schema (WD21).
- **PR #228** -- PR-C0 structured-output memo writer (Gemini JSON mode + retry-once-on-malformed). HALT 3 parse-rate gate: 10/10 first-try structured (NVIDIA, MSFT, AAPL, META, GOOGL, BRK.B, PLTR, TSLA, ORCL, Stripe). Locked Decision 2 floor (>=99%) exceeded clean. `validateStructuredMemo()` + `deriveMemoMarkdown()` exports; `[memo:malformed] type=company input_chars=<N> attempt=<1|2>` observability format.
- **PR #225** -- PR-C0a article-grounded `[n]` citation parity. `buildMemoSystemPrompt` extended with CITATION DISCIPLINE block + `MemoArticleSource` interface + `buildMemoSources` helper. Trivial conflict against C0's JSON-mode prompt resolved manually: kept C0a's length-density + provenance discipline, kept C0's JSON-output rules, adapted `[n]` discipline to `paragraphs[].text -> sources[].n`.
- **PR #222** -- PR-B1 CompanyDetailHeader + CompanyAliasRibbon. 270 LOC (10 over recon's 240 hard cap; documented as soft-over per brief allowance). 44x44 logo + ticker chip + sentiment pill xs.
- **PR #223** -- PR-B3 ThemesCard right rail + `deriveThemes` helper. Resolves Critical Finding C9. Tone mapping: bullish>=0.6 / bearish<=0.4 / else neutral.
- **PR #224** -- PR-B4 TrendCard right rail (Path A: UI only, reuses A3 mentions7d/sentiment7d -- no aggregation route). 152 LOC.
- **PR #227** -- PR-B2 KPIStrip + `/api/company-kpis` with Yahoo v10 crumb auth. 437 LOC (37 over 400 cap, recon-anticipated for crumb-auth + private-branch complexity). 30-min crumb cache; `defaultKeyStatistics.floatShares` corrected; `earningsHistory.history[LAST]` corrected.

**Phase 5 (5 PRs, dispatched parallel after Phase 4 HALT 6 batch merge):**

- **PR #229** -- PR-C3 ThemesTab expanded view + per-theme 8d sparkline. `deriveThemes(themes, articles, limit?)` extended with optional `limit` (default 6, preserves right-rail backward-compat).
- **PR #230** -- PR-C2 ArticlesTab + ArticlesTable + ArticlesRow. 5 columns (Type / Headline / Source / Tone / Age, omits relevanceScore). Client-side `publishedAt DESC` sort. Focus-on-anchor keyboard nav (no roving tabindex). camelCase field renames documented (`title` not "headline", `publishedAt` not "published_at", `dealType` not "deal_type", lowercase `sentiment`).
- **PR #233** -- PR-C4 TrendTab Path D (8d-only, NO toggle UI). HALT 6 decision: dropped `trend-tab-window-toggle` testid, deferred toggle + `/api/company-trend` route to PR-C4b (post-Phase-1, pre-PR-#197 -- spec landed in `docs/w2-c-phase-1-build-pr-specs.md` Section 3b at commit `14694a1`).
- **PR #232** -- PR-C5 SourcesTab + SourcesStrip + hard-coded tier map with feed-channel variants. NVDA pool stores feed-channel names ("Bloomberg Tech", "FT Tech", "WSJ Markets") -- naive tier map without variants would falsely T3 100% of NVDA articles. `classifyTier` uses `ReadonlySet` exact-match (no regex, no prefix).
- **PR #231** -- PR-C1 BriefTab + 4 sub-components (TLDR / Lead / Context / Watch). Inline POST to `/api/memo` (caching = W2-D follow-up). `CitedText` extended with optional `citeTestIdPrefix` prop (backward-compat preserved, ~5-10 LOC primitive extension).

**Phase 6 (5 PRs, dispatched after Phase 5 batch merge with autonomous validation):**

- **PR #236** -- PR-E0 wire CompanyDetailLayout into `/company/[id]` route. **Gating PR for Phase 6** -- without this, the C-series tabs ship as dead components. All 6 layout slots wired in one shot (tabContent + header + aliasRibbon + kpiStrip + rightRail + bottom). Data flow: legacy `fetchCompanyArticles + companies row lookup + Finnhub backstop` chain replaced with single `getCompanyDetail(supabase, canonicalize(name))` call. New `CompanyMemoModalListener.tsx` (48 LOC, event-driven) preserves Generate-Memo button behavior without modifying Lucas-protected `MemoModal.tsx`. Spec deviation: hook uses `?tab=` query param (NOT URL hash); hook is canonical, deviation documented.
- **PR #234** -- PR-D1 ComingSoonTab + ComingSoonCard for F6/F7/F8/F9 placeholders. **Spec label correction**: spec said "F7 Insider, F8 Options, F9 Peers"; PR-A2 (live codebase) locks F6=Filings, F7=Transcripts, F8=Insider, F9=Comps. Implementer honored PR-A2.
- **PR #235** -- PR-E2 WebFallbackState + Banner + Citation. Standalone presentational components (integration into route deferred per existing KNOWN-DEFERRED smoke rows J1-J9). `WebFallbackCitation` reuses `Cite` primitive with `color="var(--purple)"`; dedicated regex `/(\[w\d+\])/g` (cited-text.tsx untouched per scope).
- **PR #237** -- PR-E3 LoadingState + Skeleton + StatusChip + idiomatic `loading.tsx` route file convention. Option A wiring (Next.js 16 App Router). 3-stage chip (`fetching -> parsing -> rendering`) cycling 900ms; reduced-motion freeze handled by existing `globals.css:377` block.
- **PR #238** -- PR-E1 EmptyState + EmptyStateCTA + null-branch wiring (replaces TODO(E1) marker from E0). Watchlist CTA replicates `CompanyDetailHeader.tsx:59-89` pattern (POST `/api/watchlist` + `dispatchEvent("watchlist:changed")`); does NOT import from Lucas-protected `watchlist-utils.ts`. Focus-on-mount via `forwardRef`.

**Doc commits to main this session (Phase 7 prep on main):**

- `f09af82` -- WD30 (aliases.is_canonical enrichment as P2, surfaced during PR-B0 schema-vs-live mismatch)
- `4a6e133` -- WD31/WD32/WD33 (surfaced during PR-D2 acceptance test: legacy memo trigger missing `company` field for source_id; memo prompt grounds in stale FY22 figures; `/api/memo` curl-test access friction)
- `14694a1` -- PR-C4b spec append + Path D note on PR-C4 entry (toggle + `/api/company-trend` route deferred)

**Total Phase 4/5/6 ship: 18 PRs / ~3000 LOC across new tab system, observability substrate, 4 state variants, header/rail/strip/sources composition, and full route rewiring. Zero Lucas-protected file modifications across all 18 PRs.**

## HALT 4 acceptance test (2026-05-07) -- PASSED

Migration `20260507073312_output_log_v0_stub.sql` applied to dev Supabase (`pnfjelfvtypkpnwpflmv`). NVIDIA memo triggered via D2 preview UI; `SELECT * FROM output_log_v0_stub ORDER BY generated_at DESC LIMIT 1` returned valid row: `output_type="memo"`, `source_table="companies"`, `source_id="unknown"` (caller-side gap from legacy modal -- filed as WD31, resolves naturally when PR-C1 BriefTab replaces the trigger), `latency_ms=3757`, `prompt_inputs` + `metadata` JSONB valid.

## HALT 8 -- RESOLVED (PR #197 self-merged to main 2026-05-11 at commit `22cda0c`)

Phase 7 prep complete. PR #197 (`Noah/w2 c phase 1`) was OPEN, mergeable, base=main, head=noah/w2-c-phase-1 at the time this halt was filed. Self-merge executed 2026-05-11 morning per locked plan; details captured in the "Recently Completed (2026-05-11) -- W2-C Phase 1 ship" section above.

**Open items for self-merge sequence:**

1. **PR-C4b** -- spec landed in `docs/w2-c-phase-1-build-pr-specs.md` Section 3b on main. Builds 30d/90d/1y window toggle + `/api/company-trend` aggregation route (~280-340 LOC). Should ship BEFORE #197 merge per locked sequence (post-Phase-1, pre-#197). If shipping first feels heavy and you'd rather defer, document in W2-D backlog and ship #197 -- the toggle won't render but the underlying tab works at 8d.
2. **Visual smoke testing of new tab UI** -- DEFERRED during autonomous run because /company/[slug] requires Supabase user session (auth-blocked). Recommend live verification on integration preview after self-merge: `https://breakingalpha-git-noah-w2-c-phase-1-lucasturcuato-afks-projects.vercel.app/company/nvidia` (with browser session). Validate F1-F5 tab keyboard nav (Alt+1..5 + `[` / `]`), URL state via `?tab=` query param, all 5 tabs render data, Brief tab fetches memo via inline POST.
3. **Axe re-baseline** -- DEFERRED for same auth-blocked reason. PR-A0 baseline was 96 nodes / 5 rules / 18 rule-route. T1 ceiling per the smoke-test recipe is `<=18 rule-route`. Run axe on /company/nvidia post-self-merge to confirm no regression.
4. **Smoke test recipe (180 rows)** -- mostly auth-required for /company/* routes. KNOWN-DEFERRED until visual smoke pass. Public-route subset (auth/login, /, etc.) responded HTTP 200 cleanly during autonomous validation. K1-K3 (Loading state) testable via artificial slowdown; J1-J9 (Web fallback) explicitly KNOWN-DEFERRED per recipe.

**W2-D follow-ups worth noting in backlog (already filed at WD30-WD33):**
- WD30 -- aliases.is_canonical column for explicit canonical preference
- WD31 -- legacy /company/[slug] memo trigger doesn't pass company name
- WD32 -- memo prompt grounds in stale historical figures (FY22 instead of FY26)
- WD33 -- `/api/memo` requires Supabase session, blocks automated curl-based acceptance testing

## Recently Completed (2026-05-03)
**PR #175 and PR #177 both merged:** Email polish (#175) landed with unsubscribe/opt-out infrastructure (HMAC tokens, List-Unsubscribe RFC 8058 headers, issue numbering); sql/brief_email_unsubscribe.sql applied to prod. Web-fallback typo normalization (#177) resolved follow-up (a): canonicalName now derived from result evidence (n-gram mining + Sorensen-Dice similarity), eliminating typo propagation (e.g. "Perishing Square" → "Pershing Square"). PR #177 includes algorithmic tie-break refinement and known limitation in case 4 (ambiguous queries). Follow-up (b) citation parity for article-grounded memos remains open.

## Recently Completed (2026-05-02)
**Wave 3 PR #176 merged (web-search fallback for un-indexed companies):** Full feature stack: TS Exa REST wrapper (src/lib/web-search.ts), fallback API route (src/app/api/companies/web-fallback/route.ts), company-intel.ts exports (WebMemoResult, formatWebResultsForMemo, buildWebFallbackMemoSystemPrompt), MemoModal.tsx "company-web" type + optional sources prop, EmptyState CTA in company/page.tsx, 3-layer feature gate (default off). Truncation fix (commit 7e07688): web-fallback memos exceeded 750 maxOutputTokens ceiling; ternary per-type: company-web → 8192, company → 750. Article URLs + deduplication by canonical URL + title normalization already in place. Web search cache table (sql/web_search_cache.sql) required before flag enable (6h TTL, not blocking merge). Two follow-ups surfaced: (a) typo propagation (user's raw query echoed into memo titles/prompts — surfaces in web-fallback/route.ts + company/page.tsx), (b) citation parity for article-grounded memos (currently only web-fallback has per-claim citations; article-grounded path could adopt same discipline). One third follow-up mentioned by Noah but not fully specified; captured in Pending Issues for next session.

## Recently Completed (2026-05-01)
**Wave 1 orchestration complete:** PRs #167 (fix: brief flaky-render via page-transition), #168 (fix: mood-bar SSoT via useLiveMood hook), #169 (feat: track-record live-score grading) merged to main via parallel git worktrees. PR #170 (fix: contact email swap + legal nav + domain string) merged at e1d19ee (prior handoff claim was stale). Auth redirect bug diagnosed (`docs/auth-redirect-diagnosis.md`): Supabase Site URL + Redirect URLs allowlist still pinned to old `*.vercel.app` — requires manual Noah action. Track-record DDL (`sql/live_score_columns.sql`) needs manual application to Supabase prod; frontend renders correctly without it via TS fallback.

---

---

## 1. What happened this session

### PR #131 production validation — PASSED
- Morning Brief PDF export: POST `/api/brief/export-pdf` → 200, "PDF downloaded" confirmation visible in UI, no error toast
- Evening Wrap PDF export: POST → 200 (verified via Chrome MCP network log)
- Cookie-forwarded auth flow works end-to-end on prod. Vercel SSO bypass code path is correctly a no-op on prod (preview-only)

### PR #130 (cliche-detector-v1) — CLOSED
Closed via Chrome MCP. Branch `feat/cliche-detector-v1` preserved; only the PR is closed.

**Why closed:** Ran 3-way runtime comparison via Claude Code (main vs #129 vs #130) against today's article pool with Supabase writes intercepted in-memory. PR #130 produced a measurably worse brief:
- Orphaned "However," in market_pulse with no contrasting clause to oppose (sentence 1's content was stripped, sentence 2's "However" left dangling)
- Two of three `top_deals[].one_liner` fields emptied to "" — renders as blank cards in production UI
- Inconsistent regex enforcement: same banned word ("indicates", "signaling") stripped in some fields, retained in others within the same brief
- Retry budget didn't help: `lead_paragraph` and `supporting_context` triggered retries, retries didn't clear the cliche, fields got stripped anyway
- Detector flagged legitimate financial usage (e.g. "signaling sustained interest") and nuked entire sentences containing real news (€8B Vinted valuation lost from market_pulse)
- Runtime jumped 11s → 29s (2.6×) for retries that didn't succeed

**What's salvageable for v2:** The detector observability (hit counts per pattern, fields that triggered) is genuinely useful. Right v2 is observability-only first — log clichés to a `brief_quality_scores.cliche_actions` jsonb column, ship for a week, see which clichés actually appear most often and where, then add stripping only to fields where empty output is non-fatal, with a sentence-coherence post-pass that catches orphan conjunctions.

### PR #129 (lead-preselect-v1) — STAYS DRAFT
**Verdict:** promising but unvalidated. Don't merge yet.

**What we learned:**
- ✅ Mergeable: GitHub compare view confirms "Able to merge" against current main, no conflicts (handoff's prediction of synthesize.py conflict surface was wrong)
- ✅ All CI checks pass (3/3), Vercel preview deployed cleanly Apr 24
- ✅ No migration prerequisite. Claude Code confirmed reading PR #129's actual diff: it does NOT add a `briefings.preselect_reason` column write. The reason code lives only on an in-memory `_preselect_reason` field on the article dict. The `primary_story_id` column it writes to already exists in prod (verified via Supabase SQL editor)
- ✅ Code didn't crash. Branch produced a complete brief JSON with a different headline than main ("Global Military Spending Reaches Record $2.9 Trillion" vs main's "EBay Rival Vinted Valued at €8 Billion")
- ✅ Top Deals same as main (Vinted, Kashable, vVardis) — deal extraction undisturbed

**What we don't yet know:**
- Today's afternoon test only exercised the **macro fallback path** (Filter B → military spending). `deal_flow` had 0 rows in the last 24h (latest is 2026-04-17, 10 days stale). The **priced-deal primary path** — which is the actual justification for the PR — was never tested.
- Whether the headline the macro-fallback chose ("Global Military Spending") is consistently better than what Gemini chooses unaided. One data point isn't enough; arguably main's Vinted headline is the better lede today.
- One yellow flag: lead-preselect's market_pulse had 2 cliché hits vs main's 1. Adding the pre-selector might make Gemini's narration slightly worse because it's narrating around an externally-imposed lead rather than its own choice. Worth watching.

**Action for next session:** Re-run the 3-way comparison on a day with priced $1B+ deals in `deal_flow`. If the priced-deal path picks a sensible lead, mark Ready for Review and merge. If it picks something clearly worse than what Gemini would've picked, fix scoring before merging.

### Lucas reply — SENT (verify in your channel of choice)
Used "more context on closures" variant. Covers PR #131 status, PR #130 closure rationale, PR #129 staying draft, unblocks `lucas/intelligence-sprint` rebase, gives him narrow caution about lead-selection block in synthesize.py.

---

## 2. Findings to track (logged, not blocking)

### React #418 hydration error on /morning-brief and /evening-wrap
- Caught in console during prod smoke test
- PR #132 supposedly fixed hydration on these routes via `useState` lazy initializer (per handoff "Recently Completed 2026-04-25")
- Either regressed or new instance. Not blocking PDF export. Worth a 10-min look next session.
- Stack trace points into minified Next.js chunks — needs source map or a dev-mode reproduction to identify the actual component

### deal_flow staleness (10 days)
- `deal_flow` last 24h: 0 rows. Latest entry 2026-04-17.
- Cron-job.org Morning Pipeline fired clean at 6am ET 4/27 (returned 204), so the trigger works.
- Means deal_extractor is either not extracting, not writing, or extracting things that don't meet insert criteria.
- Independent of PR #129 but **blocks the PR #129 priced-deal path test** until resolved.
- Diagnostic for next session: check `pipeline_runs` table for last 7 days, look at deal_extractor step output. deal_extractor still uses Groq llama-3.1-8b-instant per prior handoff — could be Groq API issue.

---

## 3. THREE OPEN THREADS for next session (priority order)

### Thread A: PR #129 re-test
**Trigger:** wait until `deal_flow` has rows from the last 24h with at least one $1B+ priced deal.
**Blocker:** the deal_flow staleness above. Until that's resolved, PR #129's primary path can't be tested.
**Action:** Re-run the same 3-way comparison Claude Code did this session (artifacts at `/tmp/pr-comparison/`). Same prompt, same wrapper, same Supabase-write interception — just on a day with priced deals.
**Maybe-tonight option:** Evening wrap cron at 8pm PT could populate deal_flow if deal_extractor isn't broken. Watch that run.

### Thread B: deal_flow staleness diagnosis
**Why it matters:** Blocks Thread A. Also means production briefs are missing a signal source for 10 days running.
**Diagnostic queries:**
```sql
SELECT created_at::date, COUNT(*) FROM deal_flow GROUP BY created_at::date ORDER BY created_at::date DESC LIMIT 14;
SELECT id, run_started_at, status, error_message FROM pipeline_runs ORDER BY run_started_at DESC LIMIT 14;
```
Then look at `deal_extractor.py` step output in the most recent runs. May be a Groq API issue (deal_extractor still uses Groq llama-3.1-8b-instant per handoff).

### Thread C: React #418 hydration regression
**Why it matters:** User-facing console error on every brief page load.
**Diagnostic:** reproduce locally on dev server, compare with PR #132's `useState` lazy initializer fix, find the new component that's hydrating with mismatched text.

---

## 4. Other items deferred (carried forward)

### Personalization addendum investigation
Neither smoke-test PDF showed visible "For You" addendum content. Three possible reasons (unchanged from previous handoff):
1. `user_briefings.addendum` is empty for noahhanning's user_id today
2. print-brief.tsx doesn't render the addendum even when present
3. Cookie forwarding works but API drops the addendum field

Diagnostic: `SELECT user_id, briefing_date, length(addendum) FROM user_briefings WHERE briefing_date = CURRENT_DATE;` then trace render path if data exists.

### PDF design overhaul (proposed PR #134)
Unchanged. Newsletter-style redesign of `src/components/brief/print-brief.tsx`. Not blocking.

### Three locked agent worktrees from 4/24
Still in `.claude/worktrees/`. From this session we know they were used to host the PR branches when Claude Code couldn't `git checkout` them in main tree. Cleanup chore.

### HANDOFF.md / BUGFIX_NOTES.md cleanup (now overdue)
- Retire "STATUS UNKNOWN" labels on migration audit (this session confirmed `primary_story_id` present, `preselect_reason` not present and not needed by PR #129)
- Fix BUGFIX_NOTES typo: `morning_brief_outcomes` should be `morning_brief_call_outcomes`
- Add Vercel SSO bypass mechanism note for future devs

---

## 5. State on disk for next session

### Local repo (`~/breakingalpha`)
- main is current, working tree clean
- Active feature branches preserved: `feat/lead-preselect-v1`, `feat/cliche-detector-v1` (PR closed but branch alive)
- Locked agent worktrees: `.claude/worktrees/agent-a534…` (#129) and `.claude/worktrees/agent-acf6…` (#130) — Claude Code couldn't checkout these branches in main tree, ran from worktree backend/ via BACKEND_PATH

### Comparison artifacts (`/tmp/pr-comparison/`)
**Important: `/tmp` wipes on macOS reboot.** If you reboot before next session, these are gone. To preserve, copy to `~/breakingalpha/.session-artifacts/2026-04-27/` or similar.
- `REPORT.md` — full 3-way comparison
- `main.json` / `lead-preselect-v1.json` / `cliche-detector-v1.json` — actual brief outputs
- `*.log` — full stdout/stderr from each run
- `*.capture.json` — intercepted Supabase write payloads
- `branches.txt` — head SHA for each branch tested
- `command.txt` — exact synthesize invocation Claude Code documented
- `run_synth.py` / `build_report.py` / `check_dealflow.py` / `check_supabase.py` — wrapper and helper scripts (reusable for next test)

### Supabase prod state (`pnfjelfvtypkpnwpflmv`)
- `briefings.primary_story_id` exists (text, nullable). Last 7 days: 9 morning briefs, 2 with primary_story_id; 6 evening briefs, 1 with primary_story_id. Gemini elective-write rate is ~20%, which is the problem PR #129 solves.
- `briefings.preselect_reason` does NOT exist. Confirmed not needed.
- `deal_flow` last 24h: 0 rows. Latest entry 2026-04-17 (10 days stale).

---

## 6. User preferences for the new Claude session

Same as before, no changes:

- Blunt, founder-grade tone
- No em-dashes
- Recon-first (separate diagnostic and fix prompts; don't combine them)
- Copy-paste-ready prompts when handing off to Claude Code
- One highest-leverage next step at a time, not brainstorming
- Sanity-check destructive/irreversible actions before clicking
- Drive Chrome MCP, GitHub, Supabase, Vercel directly — don't ask Noah to click
- Prefer single-message structured deliverables over multi-turn chatter
- Push back when Noah's logic seems off (don't capitulate)

---

## 7. The exact thing the new Claude session should do FIRST

Read this handoff section + the prior 2026-04-27 (afternoon) section for the prior context.

Then ask Noah what he wants to brainstorm/tackle. He's flagged he's NOT done for the night and wants to brainstorm rather than execute a specific task.

Candidate threads in priority order (use these to anchor brainstorming, not to push):
1. **deal_flow staleness diagnosis** (Thread B) — blocks PR #129 re-test, possibly blocks production brief quality
2. **Evening cron observation at 8pm PT** — opportunity to diagnose Thread B in real-time and potentially unlock PR #129 re-test
3. **React #418 hydration regression** (Thread C) — user-visible console error
4. **Personalization addendum investigation** — neither smoke-test PDF showed the addendum
5. **HANDOFF.md / BUGFIX_NOTES.md cleanup** — overdue, not urgent

Don't preempt Noah's choice. Let him steer.

---

# Signalera Handoff

## Current Status (2026-04-20)
- Live at https://breakingalpha.vercel.app (deploying as Signalera)
- Full rebrand from BreakingAlpha to Signalera shipped — logo, fonts, theme, auth page
- Auth middleware protecting all routes — unauthenticated users redirect to /auth
- Google OAuth (PKCE flow) working — callback at /auth/callback
- Per-session user isolation fixed — greeting, sidebar, settings all read from live auth
- **Personalization system consolidated** — single `user_profiles` table + `/api/user-profile` API route + `useUserProfile()` React Context; deleted duplicate systems; 401 profile settings errors fixed via cookie-based auth + RLS migration
- Pipeline auto-runs 10:00 UTC / 6am ET (morning) and 04:00 UTC / 8pm PT (evening), weekdays — triggered by **cron-job.org** (not GitHub Actions native cron)
- **AI provider:** Gemini 2.5 Flash (migrated from Groq 2026-04-10) — ingest, thesis, memo all use genai SDK
- **Backend SDK:** google.genai (newer SDK, matches frontend pattern)
- **Entity quality:** Full pipeline wired end-to-end (Gemini typed extraction → blocklist → Wikidata validation → clean_companies), stub briefing issue (PR #82) resolved
- **Thesis drag-to-archive fix:** RLS blocking PATCH via anon key — added `supabaseAdmin` client using `SUPABASE_SERVICE_ROLE_KEY` with detailed logging

## Architecture
- **Frontend:** Next.js 16 (Turbopack), hosted on Vercel (repo root)
- **Backend:** Python — ingest.py, synthesize.py, deal_extractor.py, run.py (8-step pipeline: ingest → synthesize → deal extraction → run record → critique → audit → trend map → summary)
- **Database:** Supabase (project: pnfjelfvtypkpnwpflmv) — use ingested_at for ordering, NOT created_at
- **AI:** Gemini 2.5 Flash (migrated from Groq) — ingest batch filtering, thesis generation, memo synthesis all use google.genai
- **News:** NewsAPI + 15 RSS feeds (added SEC 8-K, SEC 10-Q, Federal Reserve, PR Newswire)
- **Scheduler:** cron-job.org → GitHub `workflow_dispatch` (GitHub Actions native cron removed 2026-04-13 — unreliable)
- **Quotes:** Finnhub (primary) + Stooq CSV (fallback)
- **Auth:** Supabase Auth — Google OAuth (PKCE), email/password sign-up
- **Design:** Playfair Display (headings) + Inter (body) + JetBrains Mono (data), gold #F5A623 accent

## Environment
- **Repo:** github.com/lucasturcuato-afk/breakingalpha
- **Live:** breakingalpha.vercel.app
- **Supabase:** project pnfjelfvtypkpnwpflmv
- **Local:** /Desktop/signalera
- **Vercel Root Directory:** repo root (was previously frontend/, cleared during V2 rebrand)

## Environment Variables
**Vercel:**
NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_FINNHUB_KEY, GEMINI_API_KEY

**GitHub Secrets (backend):**
GEMINI_API_KEY, NEWS_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY

## Pipeline Scheduler (cron-job.org)

Replaced GitHub Actions native cron on 2026-04-13 — GitHub's built-in scheduler is unreliable (silently skips runs, disabled after 60 days inactivity). cron-job.org POSTs to the GitHub `workflow_dispatch` API endpoint instead.

**Dispatch endpoint:**
`POST https://api.github.com/repos/lucasturcuato-afk/breakingalpha/actions/workflows/schedule.yml/dispatches`

**PAT:** `signalera-cron-dispatch` (classic token, `repo` scope)
**PAT expiry:** April 13, 2027 — **must be rotated before this date** (github.com/settings/tokens)

**Schedule:**
| Job | cron-job.org title | UTC | ET |
|-----|--------------------|-----|----|
| Morning | Signalera Morning Pipeline | 10:00 Mon–Fri | 6am ET |
| Evening | Signalera Evening Pipeline | 04:00 Mon–Fri | 8pm PT |

**Request headers (both jobs):**
- `Authorization: Bearer <PAT>`
- `Accept: application/vnd.github+json`
- `Content-Type: application/json`

**Request body:**
- Morning job: `{"ref":"main"}` (uses default mode)
- Evening job: `{"ref":"main","inputs":{"mode":"evening"}}`

**If runs stop:**
1. Check cron-job.org execution log — look for non-204 response codes
2. If 401: PAT expired or revoked → regenerate at github.com/settings/tokens, update both jobs
3. If 404: workflow file missing from main or repo renamed
4. If jobs show 204 but no GitHub run appears: check Actions tab for workflow disablement

## Auth Flow
- `src/middleware.ts` — `isAuthPage` exact-matches `/auth` only; `/auth/callback` is in `isPublicPath` so OAuth code exchange is never intercepted
- `src/app/auth/page.tsx` — split layout, Google SSO + email/password, `prompt: "select_account"` for account switching
- `src/app/auth/callback/route.ts` — PKCE code exchange, redirects to /dashboard
- `src/app/page.tsx` — server component: authenticated → redirect /dashboard; unauthenticated → renders LandingPage
- **Supabase URL Config:** Site URL = `https://breakingalpha.vercel.app`; Additional Redirect URLs must include `https://*.vercel.app/**` for preview deployments to work with Google OAuth

## Supabase Schema
**articles:** id, title, summary, content, url, source, published_at, ingested_at, relevance_score, relevance_reason, companies, themes, sentiment, sector, deal_type, primary_company (TEXT, nullable)

**briefings:** briefing_type, headline, summary, created_at, market_tone (text), sections (jsonb), top_deals (jsonb), sector_breakdown (jsonb)

**deal_flow:** RLS enabled, public read policy. Fields: company, acquirer, deal_type, status, value, notes, source, ingested_at

**theses:** id (uuid), title, conviction, rationale, sector, catalyst, catalyst_note (text), evidence_chain (jsonb), generated_at, source. Public read/write/update RLS.

**watchlist:** id (uuid), user_id, identifier (text), type (enum: ticker/company/sector), created_at, updated_at, sort_order (integer, nullable, for drag-to-reorder). User-scoped RLS (read/insert/delete own rows).

**user_profiles:** id (uuid, FK auth.users), role (text), sectors (text[]), created_at, updated_at. RLS: user can read/write own row (single FOR ALL policy).

**user_thesis_states:** id (uuid), user_id (uuid, FK auth.users), thesis_id (uuid, FK theses), state (text: 'active'|'archived'), created_at. User-scoped RLS.

**source_credibility:** id, source (text), win_rate (float), updated_at. Credibility scores for article sources; read by signal badge system.

**watchlist_articles:** identifier, title, source, published_at, relevance_score, score_breakdown (jsonb), url, fetched_at. User-agnostic (shared per identifier). V4B added `score_breakdown` column — run `ALTER TABLE watchlist_articles ADD COLUMN IF NOT EXISTS score_breakdown jsonb` if missing.

**watchlist_notifications:** id (uuid), user_id (uuid FK), title (text), body (text), type (text), identifier (text, nullable), read (boolean, default false), created_at. User-scoped RLS. Schema in `backend/watchlist_notifications_schema.sql` — **must run manually in Supabase**.

**watchlist_price_alerts:** id (uuid), user_id (uuid FK), identifier (text), alert_type (text: percent_change/price_above/price_below), threshold (numeric), direction (text: up/down/either, nullable), enabled (boolean), last_triggered (timestamptz, nullable), created_at. UNIQUE (user_id, identifier, alert_type, threshold). Schema in `backend/watchlist_alerts_schema.sql` — **must run manually in Supabase**.

**pipeline_runs:** Extended with `brief_addendum` (text, nullable) and `brief_addendum_used` (boolean) columns for feedback loop integration (migrations: 20260414_add_brief_addendum_columns.sql, 20260414_add_brief_addendum_used_pipeline_runs.sql).

**pipeline_runs, run_articles, brief_quality_scores, selection_audit, trend_clusters:** Phase 1 observation layer tables — see git history for schemas.

**user_saved_deals:** id (uuid), user_id (uuid FK auth.users), deal_id (text, composite key: `company|acquirer|deal_type`), saved_at (timestamptz). User-scoped RLS (read/insert/delete own rows). **Manual Supabase step:** Run `GRANT SELECT, INSERT, DELETE ON user_saved_deals TO authenticated` on any new environment.

## Full Diagnostic Audit (2026-04-10)

### What Was Audited
Complete codebase audit covering: all 10 backend pipeline files, all 10 frontend pages, all API routes, all GitHub Actions workflows, all LLM prompts, Supabase query patterns, and output quality against paid-user value-add standard.

### Key Findings

**Pipeline Health — CRITICAL (RESOLVED 2026-04-11)**
- ~~`schedule.yml` does NOT provide `GEMINI_API_KEY` to the pipeline~~. **RESOLVED:** Lucas's e9e235a commit added GEMINI_API_KEY to schedule.yml env block (2026-04-11).
- `deal_extractor.py` still uses Groq (llama-3.1-8b-instant) — intentional or needs migration.
- `observe.py` model metadata constants are stale (still say llama-3.1-8b-instant / llama-3.3-70b-versatile).
- No retry on synthesis Gemini call — single transient error produces stub briefing.

**Frontend**
- Dashboard "Signals Today" shows 0 — likely because pipeline hasn't run (GEMINI_API_KEY issue), plus timezone handling could cause edge cases.
- Dashboard mood block, AI Signal Bar are hardcoded static strings.
- Trends page is entirely hardcoded with 12 static signals — no live data.
- CompactStoryCard expands on hover only, not click (touch device issue).
- Company Intel route `/company` is correctly mapped in sidebar (not a code bug).

**Data Integrity**
- All Supabase queries correctly use `ingested_at` for article ordering.
- `briefings` table correctly uses `created_at` for its own timestamps.
- RLS on `articles` and `briefings` needs verification for anon SELECT.

**Output Quality — PRIMARY CONCERN**
- Company Intel memo prompt instructs model to output Company Brief verbatim (Wikipedia-level description) and describe facts without interpretation. Produces "I could have Googled this" output.
- Morning/Evening Brief section prompts are well-structured but lack a conviction requirement — sections describe what happened without stating what it means.
- Thesis generation prompt is the best in the codebase (testable claims, IB-grade language) but lacks action statements.

### Prompt Changes Recommended (Priority Order)
1. **Company Intel prompt** — Replace "output verbatim" Company Brief with analyst positioning. Add "so what" and conviction to Recent Developments and Key Watchpoints. (Effort: M)
2. **Synthesis section prompts** — Add conviction sentence rule to all sections: end with position, not description. (Effort: S)
3. **Thesis prompt** — Add action statement requirement: what to buy/sell/watch and what invalidates. (Effort: S)
4. **Cross-section coherence rule** — Connect macro signals to deal implications across sections. (Effort: S)

### Immediate Action Required (2026-04-10, PARTIALLY RESOLVED)
1. ~~Add `GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}` to schedule.yml env block~~ — DONE (e9e235a)
2. Verify `google-genai` is in requirements.txt (or add `pip install google-genai` to workflow) — Verify in next run
3. Keep `GROQ_API_KEY` in schedule.yml (still needed for deal_extractor.py) — Still active

### Waiting on Lucas
- ~~Thesis Board UI upgrade (in progress)~~ — DONE: phases 2–6 shipped with grading, pattern memory, adversarial testing, source credibility, pattern library feedback
- ~~Autonomous improvement loop (scope unknown)~~ — DONE: implemented across phases 2–6
- Do NOT modify: thesis-board/page.tsx, /api/theses/route.ts (until next Lucas cycle)

### Open Questions
1. ~~Has GEMINI_API_KEY been added as a GitHub Secret?~~ — RESOLVED: confirmed in schedule.yml env block (e9e235a)
2. Is deal_extractor.py staying on Groq intentionally?
3. ~~What is Lucas's scope for the autonomous improvement loop?~~ — RESOLVED: 12-step pipeline with thesis grading, pattern memory, source credibility, adversarial review (phases 2–6 shipped)
4. Are there active paying users? (determines urgency of fixes)
5. Status of middleware.ts → proxy.ts rename (Next.js 16 deprecation)

## Recently Completed (2026-04-28 evening — three-PR session)

**PR #134 — deal extractor restore (merged):** Diagnosed 8-day deal_flow staleness. Root cause: PR #101 (Apr 19) migrated deal_extractor to Gemini with model `gemini-2.0-flash`, deprecated by Google. Calls returned 404 silently. Fixed via three changes: (1) bumped GEMINI_MODEL to "gemini-2.5-flash" matching synthesize.py, (2) deal_extractor.run() returns {extracted, upserted} dict, (3) run.py wraps deal step in try/except and threads status through observe.record_run, downgrading status to "degraded" when synth succeeds but deal step fails. Validated: 22 fresh deal_flow rows in tonight's 8pm cron, including Hut 8 $3.25B Debt Financing and Ineffable Intelligence $1.1B VC Round.

**PR #129 — lead-preselect v1, M&A Filter A + Filter B (merged):** Path B from SPEC_path_b_lead_preselect.md. Deterministic Python pre-picker chooses primary_story from deal_flow before Gemini synthesis. M&A Filter A (priced $1B+ M&A with named acquirer) → Filter B macro/geo/sector fallback → Gemini in-prompt fallback. Originally an "overnight draft" PR; cleaned up tonight: title rewrite, description rewrite (narrow scope explicit), rebase against main with PR #134 conflict resolved, in-code rename to "M&A Filter A" in docstrings (function names unchanged). Branch was in agent worktree at .claude/worktrees/agent-a53475761303c7358; cleanup queued.

**PR #135 — Filter A2 priced non-M&A (merged):** Audit-driven follow-up. 30-day audit (.session-artifacts/2026-04-28/audit/AUDIT_REPORT.md) showed 20 non-M&A $1B+ events vs 3 M&A — Filter A's named-acquirer gate excluded the larger pool by construction. Filter A2 mirrors Filter A's structure but with deal_type allowlist (VC Round, IPO, Debt Financing, Series A-F), no acquirer requirement, $1B threshold, observed-corpus keyword vocabulary anchored on "raised $" / "raises $" / "priced at" / "pricing of". Conservative v1: zero-corpus-hit defense-in-depth keywords for SPAC/PIPE/convertible/down-round failures intentionally omitted; will add in v2 when production data shows real failures. Observability hook: pipeline_runs.preselect_decision JSONB column persists per-run filter decision log for v2 calibration. Migration applied to prod Supabase (column added, verified). Smoke tests passed 4/4. V2 replay against tonight's pool picked X-Energy IPO ($1.02B, closed) — exactly the failure mode Filter A excluded.

**Pending follow-ups from tonight:**
- Harness env loading: .session-artifacts/2026-04-28/run_synth.py doesn't auto-load backend/.env. Add `load_dotenv("backend/.env")` for future replays.
- Tomorrow morning validation: confirm pipeline_runs.preselect_decision populates with decision log on next cron.
- 7-14 days of preselect_decision data → review for Filter A2 v2 calibration (real failure modes vs hypothesized).
- observe.py MODEL_INGEST/MODEL_SYNTH stale strings still say llama; 3-line cleanup queued for separate PR.
- Locked agent worktree at .claude/worktrees/agent-a53475761303c7358 ready for `git worktree remove --force`.

**Open Questions resolved tonight:**
- "Is deal_extractor.py staying on Groq intentionally?" → No, migrated to Gemini in PR #101 (Apr 19), restored to working state in PR #134.
- "Are non-M&A priced events covered by Filter A?" → No (by construction). Filter A2 added in PR #135.

## Recently Completed (2026-04-27)
**Bugfix & decision handoff for Noah:** PR #132 ready (5 fixes: React hydration, evening-wrap styling, migration audit with 19 items cataloged). Intelligence sprint branch preserved, 8 commits pending merge with expected conflicts. Identified blockers for Noah: PR #131 missing dependencies (@react-pdf/renderer, resend, @react-email/*), 7 TS errors from PR #131 files, framer-motion missing, 14 Supabase migrations STATUS UNKNOWN vs production. Full decision matrix in BUGFIX_NOTES.md and Pending Issues.

## Recently Completed (2026-04-25)
**PR #132 — Bugfix pass (5 commits):** React hydration mismatch on `/evening-wrap` and `/morning-brief` fixed via `useState` lazy initializer; Evening Wrap TODAY'S STORY pill muted to match morning-brief (PR #125); migration catalog audited (19 items: 7 REQUIRED, 7 OPTIONAL, 3 branch-only, 1 post-merge, 1 informational). All 14 pages smoke-tested via dev server. Noah has 3 open draft PRs (#129–#131, DO NOT MERGE); `lucas/intelligence-sprint` branch ready to merge (expect conflicts in synthesize.py, morning-brief, evening-wrap, trends, settings). `next build` fails (missing PR #131 packages); dev server works fine.

## Recently Completed (2026-04-23)
**Four-PR morning-brief stabilization sprint (PRs #124–#127 shipped to prod):** sentiment persistence in deal_extractor/deal_flow (recovered silent failures since PR #123); masthead Direction C gradient + mood bar type extensions ('mixed', 'watch'); Top Deals grid collapse (3→2→1 cols) + TODAY'S LEAD pill muted + Active Theses pill harmonization via shared SentimentPill; filter_undisclosed_deals() post-process in synthesize.py; no-cliché LANGUAGE CONSTRAINT block in MORNING_SYSTEM, EVENING_SYSTEM, deal_extractor SYSTEM_PROMPT. Validated sentiment persistence at WTI $97 vs CNBC. Pipeline A/B confirmed independent. HANDOFF.md should distinguish verified facts from spec claims from bug hypotheses — conflating led to plan corrections this session.

## Recently Completed (2026-04-21)
**Track record & trends polish (PRs #116–#117 merged to main):** Hybrid thesis grader (confidence scores, history, adversarial evidence), manual trigger endpoint + daily cron. Trends page signal radar redesign (tiered cards, integrated header, compact filters, two-line labels, hover preview with source articles). Track record empty state fix (gate on zero graded theses, not zero confirmed+invalidated). Schema reconciliation: discovered 20260416_add_theses_user_id.sql unapplied to production — per-user DB scoping missing (app-layer only); `sql/theses_current.sql` captures actual 26-column live schema. *Follow-ups pending for Noah:* After #118 merges, run `sql/0001_cleanup_zero_signal_calibration_rows.sql` in Supabase to wipe ~10 zero-signal rows; decide whether to ship user_id migration.

## Recently Completed (2026-04-20)
**Dark mode overhaul (PRs #108–#110 merged to main):** New CSS token system (5-level surface depth + warm off-white text + consistent border tokens) in `src/styles/tokens.css` and Tailwind mappings in globals.css. 10+ components patched (sidebar, topbar, mood-bar, brief-section, feed-row, deal-card, etc.). `dark-mode-overhaul` branch includes `src/lib/deal-utils.ts` getDealTypeStyle() and `src/lib/sector-colors.ts` rewrite (semantic pill color mapping via getTagPillStyle()) not yet merged separately to main.

## Recently Completed (2026-04-19)
**Deal Flow personalization and saved deals (PRs #104–#107 merged to main):** Two-column layout with analytics sidebar (268px: Pipeline Velocity, By Deal Type, Top Sectors, Largest Deals); company deduplication via `normalizeCompany()`. User profile integration: sector tracking/other split, watchlist highlighting, sector filter nudge. Saved deals table + RLS + `/api/saved-deals` server route; `/saved` page with sort controls, fade-out unsave, CSV export. Relevance scoring: `dealRelevanceScore()` + gold dot/border system (≥1.5 threshold); high-relevance row in sidebar. Fire-and-forget event tracking (`thesis_viewed`, `memo_generated`, `sector_filter_applied`) → `inferred_sector_weights`. **Manual Supabase steps:** Run `GRANT SELECT, INSERT, DELETE ON user_saved_deals TO authenticated` on any new environment. Gold dots won't appear until 4+ behavioral events compound past 1.5 threshold.

## Tomorrow Morning Validation Checkpoint (2026-04-24 after 6am PST)

After the first morning cron run (6am PST Friday 2026-04-24), validate all four PRs:

1. **Sentiment persistence:** `SELECT count(*) FROM deal_flow WHERE sentiment IS NOT NULL AND created_at > now() - interval '24 hours';` (expect > 0)
2. **Brief generation:** `SELECT count(*), max(created_at) FROM morning_brief_calls;` (expect > 0)
3. **Top Deals lead entries:** Visit `/morning-brief` — "See lead." entries should have NO filler appended
4. **Undisclosed filter:** Visit `/morning-brief` — Top Deals should have fewer or zero "Undisclosed" cards (grid should collapse if filter removed deals)
5. **No-cliché constraint validation:** Lead card, Analyst Briefing, Market Pulse narrative — count banned constructions. If materially lower than tonight's 6-per-brief, constraint is working. If not, escalate to **Approach B** (post-generation regex detector), NOT more prompt tuning.

## In Progress (2026-04-21)
**PR #118 track-record-polish (branch: noah/track-record-polish):**
- Honest empty states + backend data-layer gating for Pattern Memory and Source Credibility (previously frontend-only).
- Two commits: `4513ea7` (main implementation) and `4744b70` (fix querying thesis_verdicts instead of stale theses.outcome mirror).
- Includes `sql/0001_cleanup_zero_signal_calibration_rows.sql` for manual execution after merge (Supabase SQL editor).
- Awaiting Noah's preview QA (Vercel-SSO-gated previews); PR comment #118 has full visual checklist.
- **Schema follow-up:** Discovered 20260416_add_theses_user_id.sql never applied to production. Per-user DB scoping and dedup unique index exist only at app layer. `sql/theses_current.sql` is ground truth (26-column live schema). Decide whether to ship user_id migration with this sprint or defer.

## Recently Completed (2026-04-19)
**Opening screen cinematic landing redesign (noah/opening-screen merged to main):** Full-viewport component with 4-column scrolling signal feed background (16 real deal/market signals, 4 parallax speeds), dark vignette + amber scan line (6s sweep). 7-step animation sequence: wordmark fade → divider extend → tagline letter-spacing → feed blur-to-sharp → hero copy up → stats row up → scan line activate. Two CTAs: "Get Started" → /auth, "Explore Preview" → /preview. Stats: 25 Sectors, 600+ Companies, 200+ Deals, 2 Daily Briefs. Zero external animation libraries. Signed-out users render OpeningScreen; signed-in still redirect to /dashboard. Fixed .gitignore for frontend/.next/ and frontend/node_modules/.

## Recently Completed (2026-04-18)
**V4D Phase 2 — Signed-out shell experience (PR #100 merged to main):** PreviewContext + tri-state auth in AppShell; redirects signed-out → `/preview`, signed-in → `/dashboard`. Added dark espresso banner + sidebar CTA. Content gates on `/trends` (first 3 signals) and `/company` (first 6 companies) with gradient fade, lock icons, SignInModal. Auth detection: `getUser()` resolves ~200ms post-mount, initializes `isSignedOut: false` to avoid tri-state timing bug. `/proxy.ts` whitelist expanded for public routes.

**Watchlist V4C sprint (PR #99 merged to main):** XLSX Summary dedup fix, price alert UI + `/api/watchlist-alerts` route, price alert trigger in watchlist_sync.py with 4h cooldown. Requires manual Supabase migration: `backend/watchlist_alerts_schema.sql`.

## Recently Completed (2026-04-17)

**Watchlist V4B sprint (PR #98 merged to main):** Real SheetJS XLSX export replacing fake CSV — Articles + Summary worksheets, 30-day window, 2000-row cap. In-app notification infrastructure — `watchlist_notifications` table + `/api/watchlist-notifications` (GET/PATCH/DELETE); bell icon in sidebar with amber badge, slide-in drawer (inline style transition), mark-read/mark-all-read. Supabase Realtime watchlist count badge in sidebar. Mobile watchlist layout — `isMobile` state + resize listener, sticky bottom bar, full bottom sheet. Keyboard nav audit/fixes on watchlist pages. Relevance scoring improvements in `watchlist_sync.py` — boilerplate penalty (`BOILERPLATE_PATTERNS`), prominence boost, `score_breakdown` JSON column in `watchlist_articles`. GDELT conditional on `exa_count < 5`. Article clustering UI in `[identifier]/page.tsx` — Jaccard similarity + capitalized entity overlap via `src/lib/clustering-utils.ts`, expandable "N more sources" rows.

**Watchlist V4A sprint (PR #97 merged to main):** Drag-to-reorder via HTML5 DnD with optimistic UI + `PATCH /api/watchlist-reorder`; `sort_order` column added (migration: `backend/watchlist_sort_order_migration.sql` — **must run manually in Supabase**). Keyboard navigation: J/K/Enter/A/Esc/? on `/watchlist`, J/K/O/B/N/Esc on identifier detail page, with `isTyping`/modal guards. Export: company PDF via `window.print()` + `#company-print-content`, full watchlist print at `/watchlist/export`, CSV at `/api/export/watchlist-xlsx`. Story clustering in `watchlist_sync.py` using Jaccard token similarity + financial entity overlap (48h window); three helpers: `_title_tokens`, `extract_key_entities`, `is_same_story`. Tailwind v4 safelist: `@source inline(...)` in globals.css forces class generation; identifier page borders switched to inline styles.

## Recently Completed (2026-04-15)
**watchlist_sync.py overhaul (PR #95 open):** GDELT rate limiting (1.5s sleep after each fetch), Exa recency filter (startPublishedDate 30 days ago), post-fetch age filter (articles >35 days or future-dated dropped before scoring), Exa payload restructure (highlights moved into contents.highlights, added type/news to query, bumped to 400 chars/3 sentences), fixed Exa response parsing, URL quality filter (is_article_url() + BLOCKED_DOMAINS/BLOCKED_URL_PATTERNS; LinkedIn/Twitter/Crunchbase/jobs/profiles/homepages filtered), title length floor (≤15 chars dropped), relevance scoring overhaul (NOISE_TITLE_PATTERNS + FINANCIAL_BOOST_PATTERNS, +2 title match/+1 summary/+1 financial/-3 noise/-1 short, floor <3 rejected).

## Recently Completed (2026-04-15, prior)
**Watchlist v2 interactive enhancements (PR #94 merged):** Clickable article headlines linking to news sources; public/private split (private markers); GDELT fallback route for zero-article entries; display name cleanup (ticker prefix removal, proper company names); stat counters (articles fetched vs total displayed); expert brief quality upgrade (analyst positioning, conviction rules). New `/api/news-search` route for GDELT-powered article discovery. Multi-identifier strategy: Finnhub ticker search, Clearbit company search, GDELT fallback. Enhanced watchlist modals with clickthrough interactions.

## Recently Completed (2026-04-15)
**Watchlist Overhaul (noah/watchlist-overhaul merged):** Two-column layout with per-identifier drill-down, unified WatchlistAddInput (ticker/company/sector with Finnhub/Clearbit autocomplete), stale sector auto-migration, per-entry article fetching (`fetchArticlesForEntry` + multi-strategy `.in()/.ilike()` filters, fuzzy match with suffix-stripping), Finnhub news fallback for zero-article tickers, Finnhub ticker search route, Clearbit company autocomplete, brief-on-entry modal at `/watchlist/brief?identifier=&type=` (Gemini memo from recent articles), HTML-stripping utility, short ticker guard (<4 chars), extended Finnhub window to 30 days, fixed GS subtitle alignment, PostgREST 400 fix. **Signal Strength & Credibility Badges:** article-signal.tsx exports `getCompleteness()` (FULL/PARTIAL/SNIPPET), `getAdjustedScore()`, `CompletenessBadge`, `SignalScore`, `SourceCredibilityBadge` (reads `source_credibility` table); used in feed-row, company intel. **Brief Feedback Loop:** `brief_feedback_loop.py` computes rolling quality signal from `brief_quality_scores` + `selection_audit`, injects self-improvement addendum into next synthesis via `pipeline_runs.brief_addendum` (new columns + migrations). **Track Record Page:** live at `/track-record`, shows thesis outcomes over time from `user_thesis_states`. **UI Explainability:** WhyThisThesis component explains thesis reasoning; TickerContext shows 1d change + 52w range on thesis cards via Finnhub. **Full-Text Scraping:** `fulltext.py` scrapes open-access sources, `backfill_content.py` backfills existing articles; ingest.py calls fulltext scraper. **AI-Personalized Briefs/Memos:** `/api/briefing` and `/api/memo` inject user profile (sectors, role) into generation prompt. **MemoModal Markdown:** proper heading/bullet/bold rendering. **Trends Live:** `/trends` page dual-dimension taxonomy (industry_verticals + activity_types) with live filter pills. **System Intelligence Widget:** dashboard widget shows pipeline health, article count, brief quality. **UI Polish:** morning brief, evening wrap, fonts, conviction ring, onboarding consolidated to single `OnboardingModal.tsx`. **Personalization system consolidation:** Merged dual conflicting preference systems into single source of truth (`user_profiles` table + `/api/user-profile` route + `useUserProfile()` React Context hook). Deleted stale `/api/preferences`, `/settings`, `/onboarding` pages + duplicate onboarding modals. Fixed profile settings 401 errors via cookie-based auth + RLS migration (single FOR ALL policy). Created `user_thesis_states` junction table for per-user thesis archive state. All consumers now use shared `useUserProfile()` hook. `user_preferences` table can be dropped.

## Recently Completed (2026-04-14)
PR #88: company intel filter accuracy — explicit sector-to-vertical mapping (COMPANY_VERTICAL_OVERRIDES 74-entry ground-truth map + SECTOR_TO_VERTICAL fallback); primary_company attribution guard prevents PE firms accumulating wrong tags. PR #87: dual-row filter UI on /deal-flow (Activity Type + Sector rows, Match Any/All toggles, Clear All button); vertical filter consistency across /company and /deal-flow. Cron-job.org Evening job updated: request body now passes `{"ref":"main","inputs":{"mode":"evening"}}` (was missing mode input, defaulted to morning, causing stale Evening Wrap).

## Recently Completed (2026-04-13)
ConvictionRing CSS refactor (conic-gradient donut) + drag-to-archive RLS fix: replaced SVG strokeDasharray (broken by Tailwind v4 preflight CSS overriding strokes) with CSS conic-gradient; inner circle now uses `.conviction-ring-bg` CSS class with context-aware color overrides (`.bg-parchment-mid .conviction-ring-bg`, `.bg-cream .conviction-ring-bg`); unfilled arc warm tone (#3a3530); PATCH `/api/theses/[id]` route fixed 500 error via `supabaseAdmin` client using `SUPABASE_SERVICE_ROLE_KEY`; removed conviction text badges from ThesisList.tsx; added detailed logging (`=== PATCH START/FAILED ===`). Service role key added to .env.local. Key files: ConvictionRing.tsx, ThesisList.tsx, route.ts, globals.css.

## Recently Completed (2026-04-13)
AUTONOMOUS_IMPROVEMENT_PLAN.md brought up to date (commit 240c713): now reflects the actual 12-step pipeline (steps 9–12 thesis_grader, pattern_memory, source_credibility, adversarial added); three previously undocumented Supabase tables documented (pattern_library, weekly_digests, source_credibility_scores); all sector/SECTORS language updated to dual-dimension taxonomy (industry_verticals + activity_types); Phase Status section (§5) added with live/complete table and explicit deferred items list; section numbering corrected (now 1–15).

Sector taxonomy migration complete: observe.py, trend_mapper.py, and feed-row.tsx migrated from single `sector` field to dual-dimension taxonomy. observe.py pool query now fetches `industry_verticals` and `_reconstruct_selected()` uses `(industry_verticals or [sector])[0]` to exactly mirror synthesize.py selection logic. trend_mapper.py `fetch_run_context()` fetches `industry_verticals` and `_normalize_article()` resolves sector as `industry_verticals[0]` with fallback — cascades to all 7+ downstream cluster functions (make_cluster_key, make_cluster_label, compute_pairwise_similarity, detect_cluster_surfacing, pattern boost, etc.) without further changes. feed-row.tsx thesis button now uses `industry_verticals[0]` before falling back to `sector`. No Supabase schema changes needed (sector backward-compat column still populated by ingest.py). tsc clean. commit: 1ddb0e0.

Dual-dimension sector taxonomy system (phases 2–7): Backend types + color system (phase 2–4, c3c1d22); user preferences UI wiring (phase 7, e857d59); pill rendering in feed/story cards with two-color system (phase 5, 0615a26); full filter bar redesign with terminal-style chips and inline active colors (phase 6, 43cea15); simplified pill rendering to blue verticals + gold activity types (a6ba43f). Merged to main via PR #85.

## Recently Completed (2026-04-12)
PRs #79–#82 entity quality and pipeline stability: PR #79 added blocklist (currencies, countries, gov bodies, law firms) and keyword pre-filter (class action / law firm) to ingest; extended isJunkEntityName() in frontend. PR #80 rewrote Gemini prompt for typed `{name, entity_type}` extraction, added Wikidata validation module with Supabase caching. PR #81 fixed articles.companies being written with raw Gemini output (now uses clean_companies list); fixed KeyError from unescaped braces in prompt. PR #82 fixed stub briefing issue — Gemini thinking tokens consumed max_output_tokens budget; disabled thinking and raised max to 4096. Pipeline now fully wired end-to-end (extraction → blocklist → Wikidata → clean_companies); ready for production validation at scale.

## Recently Completed (2026-04-11)
PR #78 (feat/company-intel-prompt-rewrite) iterative refinement: 8 cumulative prompt rule updates to buildMemoSystemPrompt() — analyst brief opener rule (proper noun required, "The" banned), low-recognition company carve-out (exception format), What Just Changed development filter (dollar figure/counterparty/product required), Cross-Signals binary verdict rule (exact format), What To Do With This bullet structure (if/then format, 75-word cap), sourcing discipline (all figures traceable to article pool), length rule (signal density not target), em-dash ban, expanded banned phrase list. Validated against live Supabase pools (NVIDIA 20 articles + Anthropic 20 articles); all figures sourced, no training knowledge leakage. Lucas's phases 2–6 commits merged in (thesis grading, pattern memory, adversarial testing, source credibility, pattern library feedback); GEMINI_API_KEY pipeline bug (previously critical) resolved via Lucas's e9e235a commit.

## Recently Completed (2026-04-10)
Full Groq→Gemini 2.5 Flash migration: frontend routes (theses, memo, thesis-detail, thesis-regenerate), backend ingest/synthesize, batch article filtering (166→127 articles, ~18min→2min pipeline), cluster-driven thesis gen, SEC/Fed feeds added, Gemini response parsing hardened (thinkingConfig, multi-fallback JSON), React hydration fix (Math.random()→deterministic), both repos clean on main, gh CLI auth set up.

## Recently Completed (2026-04-09)
Frontend debug pass completed: 8 batches (auth-gated 4 API routes, replaced createClient with createBrowserClient in 10 files, added error handling to 7 routes, Supabase/Groq validation fixes, replaced mock data with live queries across dashboard/company/ticker/shell). Resolved 8 merge conflicts (feat/signalera-frontend-v2 ↔ main), set up Playwright E2E suite (10 specs, 48 tests), created VERIFICATION.md (42 manual QA cases). Build clean, 0 TypeScript errors, 27 routes compiled.

## Recently Completed (2026-04-06)
Company Intel memo quality upgraded: replaced COMPANY_INDUSTRY string map with COMPANY_IDENTITY structured map (industry + pre-built analyst brief), injected analyst-quality sentences verbatim, tightened prompt instructions (Current Context/What To Watch prohibited from naming events outside article list). Classification hardening arc complete (primary_company matching, tiered gates, isSubjectOfTitle). 35 companies covered; prompt leakage resolved.

## What Was Done This Session (2026-04-06) — PR #57 merged to main

### Shipped — Signed-Out Conversion Funnel Restoration
1. **Landing page** (`src/components/landing/landing-page.tsx`) — signed-out users see a gated Signalera product preview at `/` with hero, stat cards, AI signal bar, story cards, and bottom CTA. Signed-in users still redirect to /dashboard.
2. **Auth gate** (`src/components/landing/auth-gate.tsx`) — blur+lock overlay wrapper; all gated interactions route to `/auth` instead of hitting raw API endpoints.
3. **Post-auth onboarding modal** (`src/components/onboarding/onboarding-modal.tsx`) — 3-step flow (Role → Sectors → Watchlist); persists to `/api/preferences` and `/api/watchlist/batch` with Bearer token on completion.
4. **Onboarding gate** (`src/components/onboarding/onboarding-gate.tsx`) — mounts on dashboard; checks `localStorage.signalera_onboarded_${userId}` (user-scoped, not browser-global); shows modal for first-time users.
5. **Middleware fix** — `isAuthPage` changed to exact match `/auth`; `/auth/callback` added to `isPublicPath` so OAuth code exchange is never intercepted.
6. **Avatar initials** — `AppShell` now fetches real user via `getUser()` and derives initials from `full_name` (email prefix fallback); was hardcoded "LT".
7. **Sidebar user card** — added sign-out button (icon-only, matches Settings icon, no name truncation).
8. **Vercel build fix** — `src/app/thesis-board/page.tsx` wrapped in Suspense boundary for `useSearchParams`.

## What Was Done This Session (2026-04-05)

### Shipped
1. **Signalera V2 rebrand** — new logo-icon.png, sidebar with "Signal" + "era" wordmark, Playfair Display + Inter + JetBrains Mono fonts, gold #F5A623 accent system, dark mode tokens
2. **Vercel deployment fixed** — root directory cleared from frontend/ to repo root
3. **Auth middleware** (`src/middleware.ts`) — all routes protected, unauthenticated → /auth, authenticated on /auth → /dashboard
4. **Google OAuth PKCE flow** — `createBrowserClient` from @supabase/ssr, callback route exchanges code for session
5. **Auth page redesign** — 55/45 split layout, left panel with brand + features, right panel with glass card, gold accents
6. **Per-session user isolation** — sidebar, greeting, settings all read from `supabase.auth.getUser()` live, no hardcoded values
7. **Watchlist API auth** — replaced hardcoded `USER_ID = "signalera_user_lucas"` with real authenticated user from cookies via createServerClient
8. **Thesis button wiring** — Live Feed "Thesis" button fetches theses, matches article sector, navigates to `/thesis-board?thesis=<id>` or shows "No thesis yet" toast. Thesis board reads `?thesis=` param and auto-selects.
9. **Weekly cross-run operator summary (PR #55)** — `backend/weekly_summary.py` aggregates observation metrics across the last 5 pipeline runs; surfaces selection quality trends, brief quality patterns, cluster momentum. Merged and production-validated.
10. **Phase 1 hardening — observe.py reconstruction fix (PR #56)** — `_reconstruct_selected()` rewritten to mirror current `synthesize._select_articles_for_synthesis()` (spine=12, floor=6, sector_cap=3, floor_min=7). `audit.py` `_TARGET_COUNT` corrected 20→18. Stale `_diversify_articles` reconstruction logic replaced. No schema changes.

## Outstanding Work Tiers

**TIER A** (Blocking, ship immediately)
- None — all shipped or validated not-a-bug.

**TIER B** (High priority, real product sprint)
- **Lead selection scoring rework** — Switch top_deals selection from first-match order to AIP/Honeywell-over-Tesla/SpaceX scoring. Biggest open product question. Real product sprint, 2–4 hours.

**TIER C** (Medium priority, shipped with validation)
- **No-cliché LANGUAGE CONSTRAINT** — SHIPPED as PR #127 (2026-04-23). Validate tomorrow morning via checkpoint #5. Iterate to **Approach B** (post-generation regex detector) if needed, NOT more prompt tuning.

**TIER D** (Ops/conversation)
- **Ingestion cadence decision** — Ops conversation with Lucas; affects cron timing and brief freshness.

**TIER E** (Multi-day, deferred)
- **Sentiment subject tagging** — Extend sentiment field with subject markers (macro/sector/company). Multi-day work, deferred.

**TIER F** (Data layer, deferred)
- **Real comp data integration** — Polygon/FMP API integration + Lucas budget conversation. Deferred.

## Pending / Known Issues

**Primary_company backfill (2026-06-12) — PR #354 EXECUTED + verified, no action needed**
- **PR #354 (feat/backfill): companies[]-only primary_company backfill tool** — `--execute` ran 2026-06-12 20:59→21:21 UTC and applied 10,669 of the 10,670 dry-run change set across 742 companies (audit log `backfill_audit_20260612T205944Z.jsonl`). Verified live in prod 2026-06-16: spot-checked audited article_ids all carry their `add_company` in `companies[]`; the original change set is fully drained. No schema change (companies[] ARRAY extraction only). The earlier "~30 rows" estimate in this doc was wrong; real change set was 10,670.
- Residual today ~2,755 rows is expected drift, not a missed backfill: 52 ingested post-run + 2,703 mapping to 264 companies first_seen after the run. One-shot backfill + go-forward #352 fold means the back-catalog drifts as the entity index grows. Optional: schedule a periodic re-run for zero-drift. Nothing blocking.

**Filter cost optimization (2026-06-02) — VALIDATION PLAN PENDING FIRST RUN**
- **PRs #305–#310 merged to main, AWAITING FIRST REAL CRON RUN** — Five-PR arc shipped end-to-end; no code issues found in dev testing. Meter delta on next live run should confirm ~$5→$1.5/run. Key validation checkpoints: (1) #307 log `[filter:usage]` line emits per run with token breakdown + estimated cost; (2) run-over-run article count stable (no flood/collapse); (3) relevance_score distribution unchanged (rubric working as expected); (4) SEC article count unchanged via deterministic bypass; (5) brief headline + pool quality visually acceptable. FLASHLITE SCOPE: filter call only (backend/ingest.py:44 FILTER_MODEL); all 14 other Gemini steps stay on gemini-2.5-flash. INGEST GATE: both `relevant==true` AND `relevance_score>=6` must independently pass. Throwaway analysis scripts (backend/scripts/) untracked, safe to delete.

**Filter prompt caching (2026-06-25) — FEATURE GATE DARK (FILTER_PROMPT_CACHE)**
- **PRs #423 and #425 merged (2026-06-25–26)** — Cacheable filter-prompt reorder behind FILTER_PROMPT_CACHE flag (default off). PR #423 adds reorder logic + caching layer in backend/ingest.py; PR #425 wires FILTER_PROMPT_CACHE environment variable into CI pipeline. This is independent from PRs #305–#310 Flash-Lite optimization. Gate still dark; requires manual enablement + cost validation before prod flip. Related PRs: #424 (retry transient Gemini errors in eval), #426 (retry transient 503 UNAVAILABLE in filter).

**Recently merged (2026-05-02) — Wave 3 in flight**
- **PR #176 — feat(company-intel): web-search fallback for un-indexed companies** — MERGED at 8a99f3f. Feature gate default off (NEXT_PUBLIC_WEB_FALLBACK_ENABLED). Truncation fix included (7e07688: per-type maxOutputTokens ternary). **Manual Supabase step required:** Apply `sql/web_search_cache.sql` (6h TTL cache table) before flag enable. NOT required before merge — flag is default off, gate returns 503.
- **Follow-up work — Wave 3 post-merge items (1 resolved, 1 open)**
  - **(a) Typo propagation in web-fallback memos** — RESOLVED by PR #177. canonicalName now derived from result evidence (n-gram mining + Sorensen-Dice similarity >0.6). Eliminates typo flow into memo title/body. Algorithmic tie-break refinement noted: "closer to query token count" added before "shorter form" rule. Known limitation: case 4 (ambiguous queries like "Bridgewater") falls back to heuristic.
  - **(b) Citation parity for article-grounded memos** — OPEN. PR #176 added per-claim `[n]` citations to web-fallback (every fact ends with citation marker). Article-grounded memos lack this (buildMemoSystemPrompt doesn't require, MemoModal doesn't render). Fix: extend buildMemoSystemPrompt to require citations; extend MemoModal to accept optional sources prop for article path. Surfaces: `src/lib/company-intel.ts:737-793` (prompt), `src/components/memo/MemoModal.tsx`, `src/app/api/memo/route.ts` (article branch).
  - **(c) Unspecified third follow-up** — Noah mentioned "three" follow-ups but detailed only two. Capture in next session.

**Open Wave 2 PRs (draft)**
- **PR #173 — AUDIT: Entity resolution current state** — branch w2/entity-resolution-audit, DRAFT read-only. Single doc: docs/entity-resolution-audit.md (398 lines). Headline: no canonical entity ID; every table holds free-text names; two parallel canonicalization layers (backend + frontend) don't share state. Alias table + canonical_id FK swap recommended (reversible, unblocks W2-B/C/H, 2-3 eng days + 1-2 weeks observation). **Lucas coordination required** before W2-A starts.
- **PR #172 — AUDIT: Track record evidence chain** — branch w2/track-record-evidence-audit, DRAFT read-only. Single doc: docs/track-record-evidence-audit.md (379 lines). KEY: thesis_verdicts already has notes + key_evidence_ids (written nightly by thesis_grader.py). Surfacing the "why" panel needs ZERO new ingestion, ZERO new LLM spend. Five product questions in doc for Noah to answer (voice / schema / LLM / placement / scope).
- **PR #174 — AUDIT: Company intel current state + improvements** — branch w2/company-intel-current-state, DRAFT read-only. Single file: docs/company-intel-current-state.md + 5 screenshots. Headline: search gap is structural (441-row table, no fallback path, bars found entries for Anduril/Mistral/Stripe/Perplexity). Memo is strong (9 patterns documented to preserve). No persistence (each click re-spends budget, no company_memos table). Mobile fails (3-col grid doesn't collapse, names truncate). Recommended: Strategy C (memo-led + directory depth), ship Strategy A first (web-search fallback) — now implemented in PR #176.

**Wave 2/3 merged**
- **PR #177 — feat(web-fallback): derive canonicalName from result evidence** — MERGED at 0d7d929. Resolves follow-up (a): typo normalization. Algorithm: 1/2/3-gram extraction from result titles + first 200 chars of summary; Sorensen-Dice similarity filter (>= 0.6) anchored to user query; sort by count desc, then proximity to query token count, then form length; top must clear 50% confidence threshold or fall back to heuristic. Files: normalize.ts (new, 313 lines, pure module), route.ts (+15/-2, wiring + bestGuessCanonical fallback). Tie-break refinement: "closer to query token count" rule before "shorter form" (see JSDoc). Known limitation: case 4 (ambiguous queries) falls back to 1-gram (documented). All 5 worked cases verified inline before commit.
- **PR #175 — fix(email): morning brief polish + view-in-browser, issue numbering, unsubscribe** — MERGED at 43fa91b. Email polish: view-in-browser bar, issue numbering, unsubscribe with HMAC-sha256 tokens (RFC 8058 List-Unsubscribe headers). New files: site-url.ts, issue-number.ts, unsubscribe-token.ts, unsubscribe/route.ts. SQL migration applied to prod: brief_email_unsubscribe.sql (adds issue_number + brief_email_subscribed columns).
- **PR #171 — fix(ui): unify user avatar component across shell** — MERGED at 34ac70a. Bug: topbar hardcoded brand "S" glyph, ignored computed `userInitials` prop. Sidebar correctly computed initials. New `src/components/shell/user-avatar.tsx` (single source of truth for avatar rendering; topbar/sidebar variants). Files touched: user-avatar.tsx (new), topbar.tsx, sidebar.tsx, app-shell.tsx, index.ts. tsc clean; lint net -1.
- **PR #170 — fix: contact email + legal nav + stale domain** — MERGED at e1d19ee. Email swap: `lucasturcuato@gmail.com` → `admin@signalera.ai`. Legal nav: added `src/app/legal/layout.tsx`. Domain: `breakingalpha.vercel.app` → `signalera.ai` in intros.

**Local worktrees — ready for cleanup:** PR #177 was branched off main in main worktree (not a new worktree created). Merged branches: `/Users/noahhanning/ba-w3-webfallback` (PR #176), `/Users/noahhanning/ba-w2-email` (PR #175), `/Users/noahhanning/ba-w2-avatars` (PR #171). Draft branches held in worktrees: `/Users/noahhanning/ba-w2-entityaudit` (PR #173), `/Users/noahhanning/ba-w2-evidenceaudit` (PR #172), `/Users/noahhanning/ba-w2-cintelaudit` (PR #174). Plus three Wave 1: `/Users/noahhanning/ba-w1-mood`, `/Users/noahhanning/ba-w1-trackrec`, `/Users/noahhanning/ba-w1-briefload` (all branches merged). **Total: 9 worktrees pending cleanup.**

**Local-dev OAuth setup (2026-06-03) — requires manual Supabase config**
- **Symptom:** Logging in from localhost dev servers (e.g., `http://localhost:3000/auth/callback`) fails because GoTrue rejects non-allowlisted localhost redirect_to and falls back to scheme-less Site URL "signalera.ai", which browser resolves as a path on supabase.co.
- **Fix (Noah's plate, dashboard-side):** Supabase project → Authentication → URL Configuration. (1) Verify Site URL is `https://signalera.ai` (with scheme). (2) Add to Redirect URLs: `http://localhost:*/auth/callback` (for local dev), keep existing `https://*.vercel.app/**` (for preview deploys).
- **Impact:** Dev-only blocker; prod login unaffected.

**Pending DDL and migrations (2026-05-03)**
- **sql/web_search_cache.sql** — Web-search fallback feature (PR #176, merged) requires manual Supabase DDL apply before flag enable (NOT before merge — flag default off). Adds `web_search_cache` table (6h TTL, keyed on query_hash + fetched_at). Apply when ready to enable `NEXT_PUBLIC_WEB_FALLBACK_ENABLED=true` in Vercel prod.
- **sql/brief_email_unsubscribe.sql** — Email feature (PR #175, merged). Migration APPLIED to prod Supabase. Adds `briefings.issue_number int`, `user_profiles.brief_email_subscribed bool default true`. Idempotent.
- **sql/live_score_columns.sql** — Track-record live-score feature requires manual Supabase DDL apply: adds `live_score`, `live_verdict`, `confidence_score` (nullable) columns + ranking indexes. Frontend renders correctly without it (TS fallback), but backend persistence won't write until applied. Apply at your convenience (not blocking, but enables backend-driven data persistence).

**Macro panel flag gating + deployment checklist**
- **Macro panel feature gates:** Both `#365` (BLS data) and `#372` (macro panel UI) deploy under dark mode. No user-facing switch yet. When ready to ship: (1) Enable BLS_API_KEY + BEA_API_KEY in Vercel prod env (CI already wired in PR #366); (2) Set flag in brief synthesizer to include `macro_snapshot.json` in output; (3) Uncomment macro panel render blocks in next.js brief route. Rollout is bright-line gated; no incremental discovery needed.

**Company Intel Financials tab — XBRL read-only**
- **PR #322** shipped Financials tab (validated XBRL via `financial_facts_latest` endpoint). Tab is live and read-only; no user writes. Sparkline rendering deferred (Phase 2). No schema changes needed.

**From prior three-PR session (2026-04-28) — deferred**
- **ENV loading in replay scripts** — .session-artifacts/2026-04-28/run_synth.py doesn't auto-load backend/.env. Add `load_dotenv("backend/.env")` for future replays.
- **Locked agent worktree cleanup** — .claude/worktrees/agent-a53475761303c7358 ready for `git worktree remove --force`.
- **observe.py stale model strings** — MODEL_INGEST/MODEL_SYNTH still say llama; 3-line cleanup queued for separate PR.
- **preselect_decision validation timing** — Confirm pipeline_runs.preselect_decision column populates on next cron.
- **Filter A2 v2 calibration window** — 7-14 days of preselect_decision data needed to review real failure modes vs hypothesized (earliest viable: 2026-05-05).

**Post-sprint follow-ups (new, 2026-04-23) — PARTIALLY RESOLVED**
- **Three migration directories with two naming conventions** — `supabase/migrations/`, `backend/migrations/`, `sql/` — need canonical-dir decision with Lucas.
- **Pill consolidation debt** — 9 non-Active-Theses pill usages still on `Badge` or duplicate SentimentPill copies. Follow-up PR to consolidate fully.
- **Three duplicate SentimentPill implementations** — `dc-story-row`, `morning-brief` page-local, `evening-wrap` page-local should consolidate to shared `src/components/ui/sentiment-pill.tsx`.
- **`stash@{0}` WIP preserved** — `feat/brief-polish-pass` (sentiment wording + panoramic pulse + `inspect_pulse` helper) still stashed. Decide next session: redundant with #123? incremental? discard?
- **Vercel preview protection bypass token** — `backend/.env` contains `VERCEL_PROTECTION_BYPASS` for automation access to preview URLs without SSO wall.

**Still open — carry forward from prior sessions**
- **PR #129 (lead-preselect v1) — stays draft pending re-test** — priced-deal primary path needs real `deal_flow` rows with $1B+ M&A deals; blocked by deal_flow staleness. Last test triggered macro-fallback path only.
- **deal_flow staleness** — last reported 2026-04-17 (pre-Wave 2). Blocks PR #129 validation. Verify current state on next cron run.
- **React #418 hydration error** — caught on `/morning-brief` and `/evening-wrap` during prior prod smoke test. PR #167 may have addressed via page-transition removal of `mode="wait"`, verify on next validation pass.
- **Personalization addendum investigation** — neither prior smoke-test PDF showed visible "For You" addendum content. Three hypotheses (user_briefings.addendum empty / render path broken / API drops field). Diagnostic query in handoff § 4.1 (old session).
- **PDF design overhaul** (proposed PR #134) — Newsletter-style redesign of `src/components/brief/print-brief.tsx`. Not blocking.

## In Progress

(None currently; see Pending section for carry-forward items.)

**Existing (deferred or blocked)**
- **Duplicate watchlist rows (IONQ, NVDA, BRK.B, AAPL)** — Pre-existing issue. PR #156 makes pin/unpin work despite duplicates by ordering by `created_at DESC` instead of ASC. Manual SQL cleanup recommended. Also: orphan-pinned `_old` duplicate rows still hold stale `pinned_position` values from before PR #156 — invisible to UI (deduped) and self-heal on next pin to each affected slot. Worth post-launch check.
- **Unapplied 20260416_add_theses_user_id.sql migration** — Phase 1 personalization per-user DB-level scoping + dedup unique index (`idx_theses_user_title_sector_unique`) only enforced at application layer (`/api/theses` POST). Neither `user_id` column, nor indices exist in live schema. Decide: ship migration retroactively or accept app-layer enforcement indefinitely. Ground-truth schema snapshot at `sql/theses_current.sql` (26 columns, generated 2026-04-21).
- **PR #118 post-merge cleanup** — After #118 merges, manually run `sql/0001_cleanup_zero_signal_calibration_rows.sql` in Supabase SQL editor to wipe ~10 zero-signal rows from `pattern_library` and `source_credibility` tables.
- **Tier 2 saved deals RLS grant** — must run `GRANT SELECT, INSERT, DELETE ON user_saved_deals TO authenticated` manually in Supabase SQL editor for new environments (migration file incomplete).
- **Relevance scoring cold start** — gold dots won't appear on fresh accounts until 4+ behavioral events compound inferred_sector_weights past 1.5 threshold. Expected, not a bug.
- **V4C watchlist_price_alerts table** — must run `backend/watchlist_alerts_schema.sql` manually in Supabase SQL editor before price alert UI/trigger is functional.
- **V4B watchlist_notifications table** — must run `backend/watchlist_notifications_schema.sql` manually in Supabase SQL editor before bell drawer shows real data.
- **V4B score_breakdown column** — run `ALTER TABLE watchlist_articles ADD COLUMN IF NOT EXISTS score_breakdown jsonb` if column was not added via V4B migration.
- **Watchlist sort_order migration pending** — V4A drag-to-reorder requires manual execution of `backend/watchlist_sort_order_migration.sql` in Supabase SQL editor to add `sort_order` column. Frontend gracefully handles missing column (null defaults to created_at order) until migration runs.
- **Track Record outcome data sparse** — Page is live but sparse outcome data until more theses cycle through archive state over time; breadth will improve as user base grows.
- **ConvictionRing partial arc fill deferred** — Currently shows full colored circle with color-coding (gold=HIGH, amber=MEDIUM, gray=WATCH, red=BEARISH); arc visualization deferred due to Tailwind v4 preflight SVG interference. Can be revisited once CSS preflight handling is resolved.
- **Wikidata validation at scale** — wikidata_entity_cache now populated on cache misses; needs full ingest run with fresh articles to validate entity quality in production
- **E2E tests need Supabase credentials** — Playwright suite configured (10 specs, 48 tests) but pending valid E2E_USER_EMAIL, E2E_USER_PASSWORD in .env.local to run against real Supabase test user
- **middleware.ts → proxy.ts** — Next.js 16 deprecation warning; rename `src/middleware.ts` to `src/proxy.ts` (breaking change in v16+)
- **Google OAuth consent screen** shows Supabase project name instead of "Signalera" — update in Google Cloud Console > OAuth consent screen
- **StoryCard Thesis button** (dashboard story cards) still inserts a new thesis directly instead of matching existing ones — only FeedRow button was updated
- **COMPANY_IDENTITY map** (35 entries, hardcoded) should eventually migrate to `company_profiles` Supabase table (ticker, industry, brief, source fields) for broader coverage
- **user_preferences table can be dropped** — Confirmed no references remain after personalization consolidation; safe to drop from Supabase
- **Article full-content archival sparse** — `content` column populated only for open-access sources; paywall-gated articles remain at summary-only; acceptable limitation for now
- **Earnings calendar integration** — requires ticker field + FMP/Polygon API; deferred
- **Legacy data inconsistency (low priority)** — a few old DB rows have stale `deal_type`/`primary_company`; won't block progress; will correct via re-ingest over time

## Nav Tabs
1. Dashboard — greeting, stat cards, top stories, system intelligence widget
2. Morning Brief — daily AI brief, top deals, analyst sections
3. Evening Wrap — end-of-day brief
4. Live Feed — 150+ articles, real-time, sector filters, auto-refreshes 60s, signal strength badges
5. Thesis Board — AI-generated theses, conviction scores, detail panel with catalyst + evidence chain + explainability
6. Deal Flow — tracked deals, manual entry
7. Company Intel — auto-extracted companies, sorted by mention frequency
8. Trends — dual-dimension taxonomy (industry_verticals + activity_types), live filter pills, signal momentum
9. Watchlist — personalized ticker/company/sector tracking, two-column layout, matched articles feed, brief-on-entry
10. Track Record — thesis outcome history, conviction vs outcome scorecard
11. Settings — profile (from auth), sectors, modules, notifications, appearance, team

## Branch Strategy
- main — production, auto-deploys to Vercel on push
- lucas/* — Lucas features, PR into main
- noah/* — Noah features, PR into main

## Division of Work
- **Lucas:** Frontend UI, design system, auth flow, Vercel deployment
- **Noah:** Backend pipeline, Groq prompt quality, Supabase schema, observation layer

## Key Links
- Live: https://breakingalpha.vercel.app
- GitHub: https://github.com/lucasturcuato-afk/breakingalpha
- Vercel: https://vercel.com/lucasturcuato-afks-projects/breakingalpha
- Actions: https://github.com/lucasturcuato-afk/breakingalpha/actions
- Supabase: project pnfjelfvtypkpnwpflmv
