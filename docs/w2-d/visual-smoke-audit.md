# W2-D visual smoke audit (auth-blocked, partial)

Thread E of the 6-thread W2-D parallel sprint. Date: 2026-05-11. Branch: `noah/w2-d-recon-smoke`. Scope: WD89 (authenticated visual smoke), WD66 (ArticlesTab layout), WD91 (empty-state bug bundle). WD88 explicitly out of scope.

This thread was READ-ONLY and did not modify any application code. Findings are based on (a) live unauthenticated Playwright captures of signalera.ai, (b) static code-read of the repo at branch base commit `22dd457`.

The thread anticipated an auth wall (per the sprint brief, `auth-state.json` was not seeded before the offline window) and executed the documented recovery path: capture whatever is reachable signed-out, then fall back to code-read verification for WD66 and WD91.

## Section 1: Auth wall documentation

### 1.1 Auth mechanism

Live probe of signalera.ai:

| Probe | Request URL | Final URL | Outcome |
|---|---|---|---|
| Landing | `https://signalera.ai/` | `https://signalera.ai/` | 200, marketing page renders |
| Detail page (random pick) | `https://signalera.ai/company/alphabet` | `https://signalera.ai/auth` | redirected, sign-in form |
| Directory | `https://signalera.ai/company` | `https://signalera.ai/company` | 200, preview render with auth-gated affordances |
| Preview shell | `https://signalera.ai/preview` | `https://signalera.ai/preview` | 200, dashboard preview |
| Preview detail | `https://signalera.ai/preview/company` | `https://signalera.ai/auth` | redirected |

Auth wall is a server-side redirect from gated routes to `/auth`. The sign-in form supports two providers:

1. Google OAuth (`Continue with Google` button)
2. Email + password (with a "Forgot password?" link and a "Create Account" tab)

No magic-link affordance is visible. Page title at the wall: `Sign In -- Signalera`.

Screenshot evidence:

- Landing: `docs/w2-d/screenshots/w2-d-landing.png`
- Auth wall: `docs/w2-d/screenshots/w2-d-auth-wall.png`
- Preview shell (dashboard, unauthenticated): `docs/w2-d/screenshots/w2-d-preview.png`
- Company directory (unauthenticated preview mode): `docs/w2-d/screenshots/w2-d-company-directory-unauth.png`

### 1.2 No auth-bypass affordances observed

Per the sprint HARD CONSTRAINT, the thread did not attempt to circumvent the auth wall. No backdoor query parameters, leaked tokens in the auth page HTML, or dev-mode bypass links were observed during the inspection. Console errors at the auth wall and on /company are non-actionable from outside.

### 1.3 Notable preview affordance

The `/preview` route renders a dashboard surface with what appears to be real (or representative) data: S&P 500 7,412.84, VIX 18.4, 10Y yield 4.41%, 301 signals today, plus a "TOP STORIES" feed listing Veeva Systems, SWK, and similar tickers. The sidebar shows real Company Intel directory rows when /company is loaded directly (Anthropic 230x mentions, OpenAI 190x, Alphabet 182x, NVIDIA 174x, Apple 161x, Meta 159x, Amazon 132x). The directory exposes "Sign in free" CTAs and "Search available after sign in" placeholder affordances, so the gating model is unauthenticated-read for the directory listing only, authenticated-read for everything else.

Implication for WD89 visual smoke: signed-out only the directory listing (1 surface) is capturable. The 20 companies x 9 tabs = 180-surface target requires a seeded session.

## Section 2: Successfully captured surfaces

| URL | Signed-in required | Screenshot path |
|---|---|---|
| `https://signalera.ai/` | no | `docs/w2-d/screenshots/w2-d-landing.png` |
| `https://signalera.ai/preview` | no | `docs/w2-d/screenshots/w2-d-preview.png` |
| `https://signalera.ai/auth` | n/a (auth surface itself) | `docs/w2-d/screenshots/w2-d-auth-wall.png` |
| `https://signalera.ai/company` | no (preview mode) | `docs/w2-d/screenshots/w2-d-company-directory-unauth.png` |
| `https://signalera.ai/company/alphabet` | yes | N/A (redirects to /auth) |
| `https://signalera.ai/company/[any]/brief..comps` (180 surfaces) | yes | N/A (redirects to /auth) |

Total live captures: 4. Code-read verifications: WD66 layout comparison (1 vs 1) + WD91 sub-bugs (4 of 4). See sections 3 and 4.

WD89 raw count for the sprint accounting:

- Target: 180 surfaces (20 companies x 9 tabs)
- Captured live (signed-out): 0 of 180
- Captured live (signed-in): 0 of 180 (auth-blocked)
- Captured live (out-of-target, useful context): 4
- Code-read substitute: not applicable for this WD; surfaces have to be rendered to be smoke-tested

WD89 status: **deferred** until `auth-state.json` is seeded (see Section 5).

## Section 3: ArticlesTab layout comparison (WD66)

WD66 in the backlog: "ArticlesTab layout divergence from prod (cards vs. columnar table)."

Prior (inline cards) and current (columnar table) both live in the repo. The transition was a Phase 1 (C1c/C1e) ship; the legacy file was deleted three commits before the audit base.

### 3.1 Provenance

| Layout | File | Status on `main` at `22dd457` | Source commits |
|---|---|---|---|
| Inline cards (legacy) | `src/components/company/company-detail-client.tsx` | deleted | `422ed92` "chore(company): remove orphaned legacy company-detail stack [WD87]" |
| Columnar table (current) | `src/components/company/tabs/ArticlesTab.tsx` + `ArticlesTable.tsx` + `ArticlesRow.tsx` | live | introduced `d664a83` (PR-C2 base), refined `57ba01c` (PR-C1e Score restore + density), repaired `5fbe05b` (PR-C1e column-collapse), bundled into `22cda0c` (Phase 1 stack) |

The transition that this WD references happened during the Phase 1 ship (PR-C2 + PR-C1e). The inline-card source file was still present on `main` until 2026-05-11 14:49 PDT (commit `422ed92` = WD87 cleanup), so the WD66 audit window is the full lifetime of the new tab. Both layouts can still be inspected via `git show 422ed92^:src/components/company/company-detail-client.tsx`.

### 3.2 Inline-card layout (legacy, deleted)

Source: `src/components/company/company-detail-client.tsx` at `422ed92^` (just before delete commit), lines 240-352.

Per-article structure:

```
[bg-white rounded-xl border p-3]
  ROW 1: [deal_type chip gold-muted] [source data-9px] [time-ago data-9px ml-auto]
         [CompletenessBadge] [SignalScore] [SourceCredibilityBadge]
  ROW 2: <h4 espresso 13px>title</h4>  [ExternalLink icon gold]
  ROW 3: <p text-secondary 11px line-clamp-2>summary</p>
```

Two groups: "Company Events" (gold/30 border, ranked above), "Sector Context" (border-base, below). Both groups render the same card structure. Summary is always visible (line-clamped to 2 lines). Metadata badges share a single horizontal row at the top of each card.

Width: max-w-[960px] mx-auto on the outer container.

### 3.3 Columnar-table layout (current, live)

Source: `src/components/company/ArticlesTable.tsx` + `ArticlesRow.tsx`.

Columns (6, fixed widths):

| Column | Width | Content |
|---|---|---|
| TYPE | 88px | dealType chip (gold-muted bg, gold-dark text, uppercase 9px) |
| HEADLINE | flex (min 200px) | `<a>` linking to article URL, truncated single line |
| SOURCE | 160px | source name + SourceCredibilityBadge + CompletenessBadge inline |
| SCORE | 56px right | getAdjustedScore() to 1dp |
| TONE | 88px | SentimentPill (BULLISH/BEARISH/NEUTRAL) |
| AGE | 72px right | formatAge() + chevron-down expand toggle |

Click anywhere on a row (or Enter/Space when row is focused) expands a full-width summary panel below (`<tr aria-hidden=!expanded>` with `colSpan=6`). Keyboard nav: ArrowDown / ArrowUp on the headline anchor moves focus to the adjacent row's anchor. tabindex flips on expanded row to receive the toggle.

No deal-type grouping ("Company Events" vs "Sector Context" headers are removed); the prior signal lives only as the deal-type chip in the TYPE column.

### 3.4 Side-by-side, code-read only

| Property | Inline cards | Columnar table |
|---|---|---|
| Default visible per article | title + summary (2-line clamp) + metadata row | title + 5 metadata cells, summary hidden behind click |
| Sortability | none (no header) | none yet (uses fixed publishedAt DESC re-sort in ArticlesTab) |
| Deal-type vs sector-context grouping | yes (two h4 strip headers) | no, merged |
| Width | content-grows | table-fixed 700px min-width with overflow-x-auto |
| Score visibility | inline at top-right of metadata row | dedicated SCORE column, right-aligned |
| Source credibility | badge in top metadata row | badge inline with source name in SOURCE column |
| Completeness | badge in top metadata row | badge inline with source name in SOURCE column |
| External-link icon | rendered to right of title | not rendered; headline itself is the link |
| Keyboard nav | none (only Tab default) | ArrowDown/ArrowUp on anchor, Enter/Space on row to expand |
| Summary access | always (clamped) | click-to-expand, per-row local state, no persistence |
| External link target | `target="_blank" rel="noopener noreferrer"` | same |
| Score formula | `getAdjustedScore(a.relevance_score, completeness)` | same |
| a11y / testid coverage | none | `articles-table`, `articles-row`, `articles-row-headline`, `articles-row-source`, `articles-row-score`, `articles-row-tone`, `articles-row-published-at`, `articles-row-expand-toggle`, `articles-row-summary-row`, `articles-row-summary`, `articles-empty-state` |

This section presents code-read facts without a judgment call. The WD66 backlog entry explicitly defers the judgment: "Both have merits ... post-#197 UX audit needed to determine which pattern beta users prefer."

## Section 4: Empty-state bug verification (WD91)

WD91 in the backlog identifies four sub-bugs at the route-level empty state surfaced at `/company/[id]` when `getCompanyDetail()` returns null (un-indexed company).

Sources read:

- `src/components/company/states/EmptyState.tsx` (113 lines, full read)
- `src/components/company/states/EmptyStateCTA.tsx` (116 lines, full read)
- `src/styles/tokens.css` (gold token grep)
- `src/app/globals.css` (gold token grep)
- `src/components/shell/topbar.tsx`, `footer.tsx`, `app-shell.tsx` (brand-string grep)
- `src/components/watchlist/WatchlistAddInput.tsx` (428 lines, full read)

### 4.1 Sub-bug (a) -- brand string says "Breaking Alpha" not "Signalera"

**Status: BUG STILL PRESENT.**

Evidence: `src/components/company/states/EmptyState.tsx:93`:

```tsx
{canonical} isn&apos;t on Breaking Alpha yet.
```

Cross-check: every other brand-mentioning surface in the shell uses "Signalera":

- `src/components/shell/topbar.tsx:79` -- `"Ask Signalera anything..."`
- `src/components/shell/footer.tsx:28` -- `<span>&copy; 2026 Signalera</span>`
- `src/components/shell/app-shell.tsx:118` -- `"You're viewing a live preview of Signalera"`
- Live site title: `Sign In -- Signalera`

This is a one-token rename. Filed as a P2 polish in WD91. Confirmed never-displayed-correctly per backlog history ("introduced in PR-E1 #238, never displayed correct brand"). Code-read sufficient; no live verify needed.

### 4.2 Sub-bug (b) -- "Add to watchlist" button uses undefined CSS tokens

**Status: BUG STILL PRESENT.**

Evidence: `src/components/company/states/EmptyStateCTA.tsx:39-45` uses `var(--gold-deep)`:

```tsx
const btnPrimary = {
  ...btnBase,
  background: "var(--gold-deep)",
  border: "1px solid var(--gold-deep)",
  color: "var(--cream)",
  cursor: "pointer",
} as const;
```

And `EmptyState.tsx:66, 74` uses `var(--gold-faint)` and `var(--gold-deep)`:

```tsx
background: "var(--gold-faint)",
border: "1px solid var(--gold-border)",
...
color: "var(--gold-deep)",
```

Gold tokens defined in `src/styles/tokens.css` (full grep result):

| Token | Defined | Notes |
|---|---|---|
| `--gold` | yes (`:root` L20, `.dark` L205) | base hue |
| `--gold-light` | yes (L21, L206) | hover lighter |
| `--gold-dark` | yes (L22, L207) | hover darker / text on muted |
| `--gold-muted` | yes (L23, L208) | low-alpha bg |
| `--gold-border` | yes (L24, L209) | border alpha |
| `--gold-deep` | **NOT DEFINED** | falls through to inherited / unset |
| `--gold-faint` | **NOT DEFINED** | falls through to inherited / unset |

`globals.css` only re-exports the five defined tokens (`--color-gold`, `--color-gold-light`, `--color-gold-dark`, `--color-gold-muted`, `--color-gold-border`).

Render impact: when a CSS custom property is unset, `background: var(--gold-deep)` yields `background: ` (invalid value -> initial -> transparent). With `color: var(--cream)` on a transparent background, the primary "Add to watchlist" button label becomes cream-on-cream-hi (parent container is `--cream-hi`), which fails practical legibility. The 56px circle icon and the gold border also fail to render their intended fills.

Backlog says "never worked." Code-read confirms it cannot work because the tokens were never defined. Fix is either: (i) define `--gold-deep` and `--gold-faint` in tokens.css, or (ii) rewrite EmptyState.tsx + EmptyStateCTA.tsx to use the defined tokens (`--gold` for deep, `--gold-muted` for faint). Either is small.

### 4.3 Sub-bug (c) -- "Search directory" has no onClick (Link to /company)

**Status: RESOLVED IN CODE -- as designed, but UX intent ambiguous.**

Evidence: `src/components/company/states/EmptyStateCTA.tsx:86-94`:

```tsx
<Link
  data-testid="company-empty-state-cta-search"
  href="/company"
  aria-label="Search company directory"
  className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
  style={btnSecondary}
>
  Search directory
</Link>
```

This is a Next.js `<Link>` with a working `href`. The link does navigate to the directory page (verified live: `/company` is reachable signed-out). The user-expected-inline-search flow the backlog references is a separate scope (WD90: "User-triggered web-fallback search on empty-state surface"). The current implementation matches its stated intent ("head to the directory to search for a different name or ticker" -- EmptyState.tsx:106-107).

This sub-bug is **not a bug in the current implementation**; it is a request for a different feature (inline search within the empty state) that has not been built. The WD91 backlog entry labels this category iii ("NEVER WORKED") only if the expectation was inline-search; categorically, what was built (link to directory) does work.

Recommend: split WD91(c) into two artifacts: (i) close as "as-designed" given the current scope, (ii) reaffirm WD90 as the actual feature ask.

### 4.4 Sub-bug (d) -- ticker controlled-input blur in WatchlistAddInput

**Status: NEEDS-LIVE-VERIFY (Lucas-protected file, byte-identical to main).**

Evidence: `src/components/watchlist/WatchlistAddInput.tsx`. The file contains the input element at L314-329 and the dropdown at L347-405. Blur-related code paths inspected:

1. Outside-click handler (L143-151): `mousedown` document listener closes the dropdown if click is outside `containerRef`. This will fire on the input itself blurring naturally.
2. Dropdown items use `onMouseDown={(e) => { e.preventDefault(); ... }}` (L359-362, L390-394) -- this is the documented React pattern to prevent input blur before the dropdown selection commits. The pattern is correctly applied.
3. Input has no explicit `onBlur` handler.

I cannot reproduce or refute the blur bug from a static read: the pattern at L359 looks correct, but a real-world blur bug could come from a focus-trap race with the parent, the sidebar revalidation event, or a Next.js client-router transition. The backlog entry explicitly notes "byte-identical to main, pre-existing, requires Lucas coordination" -- meaning the file is protected, was not touched in W2-C, and any fix needs Lucas's sign-off.

Critical caveat: the EmptyStateCTA does NOT route through WatchlistAddInput. `EmptyStateCTA.tsx:58-82` calls `POST /api/watchlist` directly with `identifier: canonical, type: "company", display_name: canonical` -- it never touches the ticker field at all. So if WD91(d) is scoped specifically to the route-level empty state, it is **not reachable from that surface** and should be re-scoped to the WatchlistAddInput component itself (which is used on `/watchlist` and on the company directory).

Recommend: re-scope WD91(d) to "WatchlistAddInput ticker-mode input blur audit on /watchlist surface" and leave the live-verify pending an authenticated session.

### 4.5 WD91 summary

| Sub-bug | Status | Code reference | Notes |
|---|---|---|---|
| (a) Brand "Breaking Alpha" -> should be "Signalera" | BUG | `EmptyState.tsx:93` | One-token rename. |
| (b) Button contrast (undefined `--gold-deep` / `--gold-faint`) | BUG | `EmptyStateCTA.tsx:40-45`, `EmptyState.tsx:66,74`; missing in `tokens.css` | Tokens never defined. Choose remap or define. |
| (c) Search Directory onClick | RESOLVED (as-designed) | `EmptyStateCTA.tsx:86-94` | Link works. The "inline search" expectation is WD90's scope. |
| (d) Ticker field blur (WatchlistAddInput) | NEEDS-LIVE-VERIFY | `WatchlistAddInput.tsx` | Not reachable from EmptyState surface. Pattern looks correct, needs authenticated repro. Lucas-protected. |

## Section 5: Filed-WD candidates

Prioritized list of follow-up WDs surfaced during this audit. The first item is the headline blocker.

1. **WD-NEW-AUTH-SEED (P0):** Seed `auth-state.json` (Playwright `storageState`) or set up an automated Playwright login-flow (Google OAuth dance, or a CI-only email/password test account guarded by env flag) so future visual-smoke threads can run end-to-end. Without this, WD89 (and any visual regression sweep) cannot complete. Suggested path: provision a test user in Supabase Auth with a service-role bootstrap script, document the seed procedure in `docs/SETUP.md`, and add `auth-state.json` to the sprint kickoff checklist alongside the `.gitignore` entry. Estimate: M.

2. **WD89-DEFERRED (P1):** Re-run the 20 companies x 9 tabs = 180-surface visual smoke once WD-NEW-AUTH-SEED is in place. This audit's Section 2 should be the deliverable template. Estimate: M (mostly capture time once auth works).

3. **WD91-A (P2):** Empty-state brand-string fix. `EmptyState.tsx:93`, change "Breaking Alpha" to "Signalera". Estimate: XS, low-risk.

4. **WD91-B (P1):** Empty-state button contrast. Either define `--gold-deep` and `--gold-faint` in `src/styles/tokens.css` (both light and dark blocks), or remap `EmptyState.tsx` + `EmptyStateCTA.tsx` to use the existing `--gold`, `--gold-muted`, `--gold-dark` tokens. Recommend the remap path so the token set stays minimal. Estimate: XS, single-file polish.

5. **WD91-C-REGROUP (P3):** Close WD91(c) as "as-designed" and confirm WD90 covers the inline-search feature. Doc-only. Estimate: XS.

6. **WD91-D-RESCOPE (P2):** Re-scope WD91(d) to "WatchlistAddInput blur on /watchlist surface", note that it is unreachable from EmptyState, and queue for live-verify after WD-NEW-AUTH-SEED. Coordinate with Lucas before any code touch.

7. **WD-NEW-LANDING-EMDASH (P3):** The landing page hero CTA "Get Started -- It's Free" renders with a literal em-dash glyph in the live build (visible in `docs/w2-d/screenshots/w2-d-landing.png`). The repo enforces ASCII-only / no-em-dash convention. Trace the source string and replace with " -- " or " : ". Estimate: XS.

8. **WD-NEW-PREVIEW-DIRECTORY-COMPLIANCE (P2):** The unauthenticated /company directory exposes real company names, real mention counts, and real "last seen" timestamps for top entities (Anthropic 230x, OpenAI 190x, Alphabet 182x, NVIDIA 174x, ...). Product confirmation needed that this is intended preview behavior and that exposing aggregate engagement signals to logged-out visitors does not constitute a data-leak concern. Likely intended (the page advertises preview), but worth a one-time review. Estimate: XS (review-only).

## Halt conditions (none triggered)

- Prod data loss: not observed.
- User data exposure beyond aggregate counts on /company: not observed.
- Auth-bypass affordance: not observed. The /preview route is an intentional public surface; /company directory is a documented public preview.
- Playwright MCP non-functional: not triggered (4 successful navigations + screenshots).

## Reproducibility notes

- Repo state: branch `noah/w2-d-recon-smoke` based on `main` at `22dd457`.
- Live captures taken: 2026-05-11, all between 14:50 and 14:51 PDT.
- Console errors at /auth and /company were observed but not investigated -- single errors per page load, not actionable from outside.
- The 4 captured screenshots are committed under `docs/w2-d/screenshots/` and referenced from this doc by relative path.
