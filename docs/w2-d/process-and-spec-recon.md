# Process & Spec Recon -- W2-D Thread C

Scope: WD71 (PR-stacking metadata audit), WD69 (ArticlesTab cursor pagination spec), WD83 (BriefTab download/export spec).
Status: READ-ONLY recon. Zero code changes in this thread. All specs end at "ready to implement"; the implementation is filed for a separate write thread.
Run date: 2026-05-11.

---

## Section 1 -- PR stacking metadata audit (WD71)

### 1.1 Measured state

```
gh pr view 244 --json baseRefName,headRefName,baseRefOid,state
{
  "baseRefName": "noah/pr-c1c-brieftab-prod-generator",
  "baseRefOid":  "d1578f856b32c9946739b8fb58bacec61771d57b",
  "headRefName": "noah/pr-c1e-articles-table-density",
  "state":       "MERGED",
  "title":       "feat(company): restore ArticlesTable density (...) [PR-C1e]"
}

gh pr view 243 --json baseRefName,headRefName,baseRefOid,state
{
  "baseRefName": "noah/w2-c-phase-1",
  "baseRefOid":  "7c4e2ea5effbbec394ae67f84c9420c5ec9879c7",
  "headRefName": "noah/pr-c1c-brieftab-prod-generator",
  "state":       "MERGED",
  "title":       "fix(w2c): abandon structured-output, restore prod main generator + client-side parse [PR-C1c]"
}
```

### 1.2 Root cause

PR #244 (PR-C1e -- ArticlesTable density) was based on **`noah/pr-c1c-brieftab-prod-generator`** (the C1c branch) instead of the integration branch **`noah/w2-c-phase-1`**. PR #243 was correctly stacked on the integration branch.

The pattern is the **classic PR-stacking failure mode**: when a developer branches off the previous PR's HEAD (instead of the integration branch they were supposed to target), the new PR's `baseRefName` points to a topic branch. As long as the parent PR merges first into integration, GitHub silently rebases the second PR's commits and the issue is invisible -- until:

- The parent PR is not yet merged when the child PR is opened. The child PR's diff then shows BOTH the parent's changes AND its own.
- A reviewer requests changes on the parent, forcing the child to re-stack.
- The parent is reverted or fast-forwarded, and the child's `baseRefOid` becomes stale.

In this specific case both PRs merged cleanly, so the symptom is latent. The risk is that the practice -- branching off the previous topic branch instead of explicitly targeting integration -- continues unflagged.

### 1.3 Process change recommendations

**Headline recommendation**: enforce that every stacked PR explicitly declares its intended integration target (and that automation flags any PR whose `baseRefName` is itself a topic branch that has not yet merged into the declared integration target).

Detailed proposals:

1. **Pre-flight gh hook in `.claude/scripts/pr-open.sh` (or equivalent)**: before opening any PR, the helper script must compare `baseRefName` against an integration-branch allowlist (`main`, `noah/w2-c-phase-1`, `noah/w2-d-*`, etc.). If `baseRefName` is a topic branch (matches `noah/pr-*`), the script must:
   - WARN with the actual divergence: `Detected stacking on noah/pr-c1c-brieftab-prod-generator. Is this intentional? (y/N)`
   - REQUIRE a `--stacked` flag on the wrapper command to suppress the warning.
   - LOG the parent PR's state (open/merged/closed) so the developer sees if the parent will block the child.

2. **GitHub Actions guard**: a `.github/workflows/pr-base-check.yml` that fails PR check when `baseRefName` matches `^noah/pr-` AND PR is not labeled `stacked`. Forces the author to either re-target main/integration, or to add the `stacked` label.

3. **Branch-naming convention**: separate `noah/pr-*` (PR topic branches, single-purpose) from `noah/stack-*` (explicitly multi-PR stacks). Convention alone is not enforcement, but pairs well with (1) and (2).

4. **Sprint-status doc**: the active sprint-status doc (`docs/w2-d/sprint-status.md`) should declare an integration branch up-front. Each thread's PR base is then a one-line lookup, not a tribal-knowledge guess.

5. **Retrospective queries**: a one-liner in the cron-audit suite to surface "PRs in last 24h whose base is a topic branch":

```
gh pr list --json number,baseRefName,headRefName,state \
  --search 'merged:>2026-05-04' \
  --jq '.[] | select(.baseRefName | test("^noah/pr-")) | {number, baseRefName, headRefName}'
```

Run weekly; trend it.

**One-line process change recommendation**: add a pre-flight gh-CLI check that warns on any PR whose `baseRefName` matches a topic-branch pattern and requires an explicit `--stacked` opt-in.

---

## Section 2 -- ArticlesTab cursor pagination spec (WD69)

### 2.1 Current state

`src/lib/data-access/getCompanyDetail.ts` line 44 holds the stopgap:

```ts
const ARTICLE_LIMIT = 50;
const ARTICLE_DAYS = 14;
```

Today's query (lines 92-99):

```ts
supabase
  .from("articles")
  .select(ARTICLE_COLS)
  .contains("companies", [head.name])
  .gte("published_at", sinceArticles)
  .order("relevance_score", { ascending: false })
  .order("published_at", { ascending: false })
  .limit(ARTICLE_LIMIT)
```

The cutoff is dual: (a) trailing 14 days, (b) top 50 by `relevance_score`. Users on high-coverage tickers (NVDA, AAPL) silently lose articles 51-N within the 14-day window.

`src/components/company/tabs/ArticlesTab.tsx` is a thin shell: re-sorts the passed-in array by `publishedAt DESC` client-side and hands to `ArticlesTable`. No pagination logic anywhere on the client.

### 2.2 Requirements

- Surface ALL articles in the trailing 14 days (not capped at 50).
- Stable cursor across new ingestion (ingestions arrive every ~15 min during US trading hours).
- Sort order: `published_at DESC` (the current client-side post-sort behaviour).
- Server-side pagination: do NOT fetch all rows then paginate on client (would defeat the purpose for NVDA-class tickers that exceed 50/day).
- Preserve scroll position when a user navigates away and back.

### 2.3 Cursor design

**Cursor shape**: `(published_at, id)` tuple, base64-encoded. The tie-break on `id` is required because `published_at` is non-unique (Tier-1 sources publish identical-timestamped articles when re-ingested from feeds).

```
type Cursor = `${ISO8601}_${UUID}`;
// Encoded: base64url(`${published_at}_${id}`)
```

The query becomes (server-side, in `getCompanyDetailArticlesPage`):

```ts
let q = supabase
  .from("articles")
  .select(ARTICLE_COLS)
  .contains("companies", [head.name])
  .gte("published_at", sinceArticles)
  .order("published_at", { ascending: false })
  .order("id",           { ascending: false })
  .limit(PAGE_SIZE + 1);  // +1 to detect more

if (cursor) {
  const [pubAt, id] = decode(cursor);
  // (published_at, id) < (cursor.pubAt, cursor.id) in lex order
  q = q.or(`published_at.lt.${pubAt},and(published_at.eq.${pubAt},id.lt.${id})`);
}
```

Result includes one extra row if there is a next page; the extra row's tuple is the next cursor; remove it from the visible slice.

### 2.4 Edge cases

| Edge case | Handling |
|---|---|
| Stable cursor across new ingestion | Cursor is anchored on `(published_at, id)`. New articles have NEWER timestamps and sit ABOVE the cursor; they are not yet visible. User sees them on next mount or via explicit refresh. No mid-scroll insertion. |
| 50-row stopgap removal | Replace `.limit(50)` with `.limit(PAGE_SIZE + 1)` where PAGE_SIZE = 25 or 50 (TBD by UX). Drop the second order-by on `relevance_score` -- it is incompatible with cursor pagination (cursor depends on the primary sort key being unique with a tie-break, and `relevance_score` is null on legacy rows). |
| Articles within trailing 14 days | Server still applies `gte(published_at, sinceArticles)`. Cursor pagination operates within this window. |
| Articles beyond 14 days | Out of scope for cursor pagination. Future enhancement: "Load more (older than 14 days)" CTA that extends the window. |
| Sentinel observer vs Load More button | UX should decide. Spec assumes IntersectionObserver (auto-load next page when the last row enters viewport). Fallback CTA: explicit "Load more" button rendered when observer is unsupported or has fired 3+ times (anti-runaway). |
| Scroll position preservation | Use `useLayoutEffect` to capture `window.scrollY` before route transition; restore on mount. Alternatively, render via a virtualized list (react-virtual) that owns its scroll offset. Recommend the simpler approach for v1: cache `scrollY` in `sessionStorage` keyed by `slug`. |
| Empty page (cursor exhausted) | Server returns `{ articles: [], nextCursor: null }`. Client shows "End of results in last 14 days" line. |
| Concurrent loads | Debounce / cancel in-flight fetches. AbortController pattern. |

### 2.5 File diff plan

| File | Action | Estimated LOC |
|---|---|---|
| `src/lib/data-access/getCompanyDetail.ts` | Split: keep `getCompanyDetail` for the first-paint shell (mentions, themes, alias mentions). Extract article fetch into a new `getCompanyDetailArticlesPage(supabase, head, cursor?)` that returns `{ articles, nextCursor }`. Remove `ARTICLE_LIMIT = 50`. | -1 (constant), +60 (new function), net +59 |
| `src/app/api/company/[slug]/articles/route.ts` (NEW) | Route handler: validate slug, resolve alias, call `getCompanyDetailArticlesPage(supabase, head, cursor)`. Return `{ articles, nextCursor }`. | +50 |
| `src/components/company/tabs/ArticlesTab.tsx` | Replace pure component with stateful hook. Initial articles passed in as `initialArticles` + `initialCursor`. New state: `pages`, `loading`, `hasMore`, `error`. New effect: IntersectionObserver on sentinel. New handler: `loadMore()`. | -8 (remove client sort -- server does it now), +80, net +72 |
| `src/components/company/tabs/ArticlesTab.test.tsx` (skipped -- no TDD in this repo per CLAUDE.md) | -- | 0 |
| `src/lib/cursors.ts` (NEW) | `encodeCursor({ publishedAt, id })`, `decodeCursor(str)` helpers. | +30 |
| `src/app/companies/[slug]/page.tsx` | Pass `initialArticles` + `initialCursor` (was `articles` only). Server-side first page from `getCompanyDetailArticlesPage` instead of `getCompanyDetail`. | +5 |

**Total LOC estimate**: ~216 lines added, ~9 removed, net **+207 LOC**.

### 2.6 Risks

- The current sort order is `relevance_score DESC, published_at DESC`. Cursor pagination forces a single sort key. Spec recommends switching to `published_at DESC, id DESC` (which matches what the client already does after re-sort). **Cross-check with PM**: is `relevance_score` actually surfaced in the UI? If yes, this is a breaking change to perceived ordering.
- `articles.companies` is `text[]`. `.contains("companies", [head.name])` is the existing filter. After WD64 (Section 4 of `entity-resolution-audit.md`), this filter migrates to `company_id` joins -- the cursor code must follow. Build cursor against the new join, not the array.
- `published_at` is nullable. Today's query silently filters them via `.gte(published_at, sinceArticles)`. Confirm zero rows with null `published_at` enter the page or cursors break.

### 2.7 Out of scope

- Search/filter within the paginated list.
- "Load more (older than 14 days)" CTA.
- Server-side sentinel rendering (no SSR for paginated body).

ZERO code in this thread. Implementation filed for a write thread.

---

## Section 3 -- BriefTab download/export spec (WD83)

### 3.1 Current state

`src/components/company/tabs/BriefTab.tsx` (full file read; LUCAS-protected files unchanged):

- Mounts -> GET `/api/memo-cache?company_id=...` -> if hit, parse + render Markdown sections.
- Miss -> shows "Generate Brief" CTA -> POST `/api/memo` -> server's `after()` hook backfills cache via `metadata.markdown_memo`.
- Render mode: prefers `parsed.sections` (3+ sections required); otherwise renders `parsed.rawMarkdown` as fallback.
- Cache state surface: `data-testid="brief-cache-hit"` / `brief-cache-miss` (hidden divs for tests), `data-cache-state="hit|fresh|miss"` on outer wrapper.
- Cached-at timestamp displayed via `relativeTime(iso)`.

`buildMemoSystemPrompt` is LUCAS-PROTECTED and not modified here.

### 3.2 Requirements

- One-tap export of the current brief to a portable, share-ready format.
- Works for both cache-hit and freshly-generated cases.
- Filename encodes the company AND the brief's generation timestamp (so multiple downloads do not collide).
- Honors per-user cache: the export shows what the user sees, no server round-trip required if the brief is already parsed in state.
- Plays nicely with the analyst workflow: paste into Slack, email to PM, archive in OneNote.

### 3.3 Format decision

| Format | Pros | Cons | Verdict |
|---|---|---|---|
| Markdown (.md) | Trivial to implement (we already have `parsed.rawMarkdown`). Universal. Slack/Notion/GitHub render it natively. Easy diff if user re-runs. | Plain text only; no headers/footers/branding. | **YES (default)** -- ship first. |
| PDF (.pdf) | Print-ready; archival; carries brand. | Heavyweight: requires `react-pdf` or server-side puppeteer. Cache busts on client/server boundary. Font-loading and pagination edge cases. | **YES (v2)** -- add after MD ships. |
| HTML (.html) | Self-contained styled doc; opens in browser. | Less universal than MD for analyst workflows. | NO. |
| JSON (.json) | Programmatic re-import. | Wrong audience for a Brief tab. | NO. |
| CSV | n/a | Wrong shape (Brief is prose). | NO. |

**Recommendation**: Markdown for v1. PDF in v2 via a `/api/brief/pdf?company=...` route that re-runs the system prompt against the cached `rawMarkdown` and renders via puppeteer (server-side, cacheable).

### 3.4 Filename convention

```
${slugify(company)}_brief_${YYYY-MM-DD}_${HHMM}.md
```

Examples:
- `nvidia_brief_2026-05-11_1432.md` (a Brief generated at 14:32 UTC on 11 May 2026).
- `paramount-skydance_brief_2026-05-11_0915.md`.

Timestamp uses `generated_at` from the cache hit response, or `Date.now()` for fresh generation. Time component disambiguates same-day re-runs without going to the second.

### 3.5 UI placement

Two options:

| Option | Description | Tradeoff |
|---|---|---|
| (A) Header pill, right side | Small icon button (download glyph) inline with the "Cached X min ago" line. | Compact, in-context, but easy to miss. |
| (B) Action row below brief body | Full-width row with: [Download MD] [Regenerate] [Copy to clipboard]. | More discoverable; sets up future actions; consumes vertical space. |

**Recommendation**: (B). Aligns with analyst-tool conventions (PM-style toolbars). The row appears ONLY when `phase === "ready"` and `parsed !== null`. Hidden during loading and error states.

```
data-testid layout (no code):
  brief-tab
    [if cachedAt] cached-time-line
    [sections-or-fallback]
    brief-actions-row
      brief-download-button   data-format="md"
      brief-regenerate-button
      brief-copy-button
```

### 3.6 Cache + per-user-key interaction

`/api/memo-cache` is keyed on `company_id` and the requesting user's session. The cache surface that BriefTab consumes is the parsed `Markdown` in client state -- which already reflects the user's view. The download button operates on `parsed.rawMarkdown` directly:

```
onClick:
  blob = new Blob([parsed.rawMarkdown], { type: 'text/markdown' })
  url  = URL.createObjectURL(blob)
  a    = <a download={filename} href={url}>
  a.click()
  URL.revokeObjectURL(url)
```

No fetch. No server round-trip. No cache key interaction beyond what BriefTab already manages. The only data the export needs (markdown + timestamp) is already in component state.

For the v2 PDF flow:

- Cache key `pdf:${company_id}:${session_user_id}` so PDFs are user-scoped (same per-user model as the markdown cache).
- TTL: same as markdown cache.
- On Brief regenerate, both caches invalidate together.

### 3.7 File diff plan

| File | Action | Estimated LOC |
|---|---|---|
| `src/components/company/tabs/BriefTab.tsx` | Add `brief-actions-row` below `[sections-or-fallback]`. New `handleDownload()` callback. New `slugify` is already present in file (line 54). Reuse. | +35 |
| `src/components/company/tabs/BriefTab.test.tsx` (skipped -- no TDD) | -- | 0 |
| `src/lib/export/brief-filename.ts` (NEW) | Pure helper: `buildBriefFilename(company, generatedAt?: Date)`. Exports utility for reuse in v2 PDF route. | +20 |

For v2 PDF (separate PR):
| File | Action | Estimated LOC |
|---|---|---|
| `src/app/api/brief/pdf/route.ts` (NEW) | POST `{ company, markdown }` -> puppeteer render -> PDF. Cache via existing memo-cache pattern. | +120 |
| `src/components/company/tabs/BriefTab.tsx` | Add second download button "[Download PDF]" calling the new route. | +15 |
| `package.json` | Add `puppeteer-core` + `@sparticuz/chromium` (Vercel-compatible). | +2 deps |

**Total LOC estimate**: v1 = **~55 LOC**. v2 = **~135 LOC + 2 deps**.

### 3.8 Edge cases

| Edge case | Handling |
|---|---|
| User downloads, then regenerates, then downloads again | Filename includes time-of-day. Two distinct files. |
| Brief is parsed via fallback (raw markdown, no sections) | Download uses `parsed.rawMarkdown` either way. No difference. |
| Empty brief | Download button is hidden when `!parsed`. Already handled by the `phase === "ready"` and `parsed !== null` gate. |
| Browser blocks programmatic downloads | Show toast: "Download blocked. Right-click the link to save." Fallback: render `<a href>` link instead of triggering click(). |
| Mobile Safari | Test on iOS: `URL.createObjectURL` + `download` attribute works but iOS displays a "Open in" sheet rather than saving. Accept as platform limitation for v1. |
| Markdown with embedded ` characters | Already handled -- `parsed.rawMarkdown` is the verbatim memo string; Blob preserves bytes. |

### 3.9 Out of scope

- Server-side audit log of who downloaded which brief when (privacy + product decision; flag for PM).
- Multi-format dropdown ("Download as MD / PDF / DOCX"). v1 ships single button; v2 adds PDF; DOCX not on roadmap.
- Email-the-brief direct integration (uses morning-brief infrastructure -- separate WD).
- Share-link generation (signed URL -- separate WD; intersects with auth/RLS).

ZERO code in this thread. Implementation filed for a write thread.

---

End of spec recon.
