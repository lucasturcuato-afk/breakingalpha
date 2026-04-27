# SPEC — PDF Export Auth Fix (PR #131)

**Branch:** `feat/pdf-rebuild-v1`
**Author:** Recon + plan, 2026-04-25
**Status:** Plan approved internally → implementing in this session
**Scope:** Replace PR #131's broken HMAC-token + service-role approach with cookie-forwarded auth so the PDF renders the user's actual personalized web view.

---

## A. Personalization state of the world

### A.1 Synthesis-time (PR #103, shipped — Noah)

- `backend/synthesize.py` defines `fetch_watchlist_signals(cutoff_hours=24)` (line 649). It queries the `watchlist` table **across all users**, then fetches `watchlist_articles` for those identifiers in the last 24h.
- Watchlist articles are tagged `[WATCHLIST]` and prepended to the Gemini prompt (line ~1090).
- The `MORNING_SYSTEM` and `EVENING_SYSTEM` prompts contain a `WATCHLIST DIRECTIVE` block (lines 27-34, 173-180) instructing the model to elevate watchlist companies in `top_deals` / `deals_and_ma` / `public_markets` / `sector_spotlight`.
- **Result: ONE briefings row per type, watchlist-aware across all users (not per-user).** Same shared brief content; the personalization is content-level, not row-level.

### A.2 Read-time (Lucas, `src/app/api/briefing/route.ts` — protected)

Confirmed by reading the file end-to-end (READ-ONLY, NOT MODIFIED):

- Reads `Authorization: Bearer <access_token>` header (lines 239-243).
- Looks up `user_profiles` columns: `first_name, role, firm_or_school, sectors, risk_appetite, watchlist_tickers, onboarding_completed, strategy_type, investment_horizon, workflow_style`.
- `shapeSections(sections, modulePrefs)` (lines 46-66) — reorders briefing sections using `MODULE_TO_SECTION` map keyed on the user's `role`. Pinned-last keys: `what_to_watch`, `tomorrow_setup`.
- `shapeSectorBreakdown(breakdown, sectorPrefs)` (lines 68-82) — reorders sector_breakdown so the user's preferred sectors appear first; uses `PREF_ALIASES` for fuzzy matching.
- `buildBriefPersonalization(profile, type)` (lines 97-216) — produces a `personalization` metadata object with `format_label`, `section_order`, `tone`, `length_modifier`, `role_context`, `watchlist_tickers`, `risk_appetite`. Per-role: `student_analyst`, `buy_side` (sub-cases by `workflow_style`), `sell_side`, `private_equity`, default RIA/family-office.
- Per-user addendum lookup (lines 311-321) reads `user_briefings` table filtered on `user_id + briefing_type`. Soft-fails if column/table missing (line 336-338).

**Response shape consumed by web pages:** `{briefing, pref_applied, personalization, user_addendum, profile_role, profile_risk_appetite, briefing_age_hours, is_stale, ...}`.

### A.3 V4B addendum / pipeline step 15 — *partially shipped*

- `backend/user_synthesis.py` **exists** in this repo.
- `backend/run.py` step `[15/16] USER-AWARE BRIEF PERSONALIZATION` (line 157-161) calls `user_synthesis.run(brief_type)` wrapped in `try/except` with `logger.warning` on failure.
- `supabase/migrations/20260416_create_user_briefings.sql` **exists** (creates table with `addendum text not null default ''`, RLS policy `auth.uid() = user_id`, indexed on `(user_id, briefing_type, generated_at desc)`).
- **Schema gap:** prior server logs reportedly say `"column user_briefings.addendum does not exist"`. That migration was never applied to prod Supabase. The migration file is present in the repo but `supabase db push` was not run.
- **Blast radius if ignored for the PDF fix:** `/api/briefing` soft-fails the addendum lookup, returns `user_addendum = null`. The web UI hides the addendum block when `userAddendum` is falsy (`morning-brief/page.tsx:933`). The PDF will do the same. **Parity preserved.** Whether/when to apply the migration is out-of-scope for this PR.

### A.4 Web UI personalization activation — *active today, contrary to RECON_NOTES.md*

`RECON_NOTES.md` (2026-04-16) flagged personalization as "latent" because frontend pages weren't sending Bearer tokens. **That note is outdated.** Verified in `src/app/morning-brief/page.tsx` lines 191-200:

```ts
const supabase = getSupabase();
const { data: { session } } = await supabase.auth.getSession();
const headers: HeadersInit = {};
if (session?.access_token) {
  headers.Authorization = `Bearer ${session.access_token}`;
}
const res = await fetch("/api/briefing?type=morning", { headers });
```

Bearer plumbing is live. Format label, user addendum, reshaped sections, reshaped sector_breakdown all flow into the rendered web view. The PDF must reproduce this.

---

## B. PR #131 auth scheme — what it does and why it fails

### B.1 Code as it stands

- `src/app/api/brief/export-pdf/route.ts`:
  - Authenticates the **incoming Next.js request** via `getSupabaseWithUser()` (cookie-based, returns 401 if no user).
  - Mints HMAC-signed token via `mintPrintToken(row.id)` — token encodes `briefing_id.exp.sig`, **no user identity**.
  - Launches Puppeteer with empty cookie jar.
  - Navigates Puppeteer to `${origin}/print/${briefing_id}?t=${token}&type=...&origin=...`.
- `src/app/print/[briefing_id]/page.tsx`:
  - Validates HMAC token against the URL's briefing_id.
  - Uses `SUPABASE_SERVICE_ROLE_KEY` to fetch the briefing row (`createClient(url, key, { auth: { persistSession: false } })`).
  - Renders `PrintBrief` with the canonical `briefings` row — **no user reshaping, no addendum, no Bearer relay**.
- `src/lib/print-token.ts`: standard HMAC-SHA256, base64url, default 15-min TTL, secret from `PDF_PRINT_SECRET || SUPABASE_SERVICE_ROLE_KEY || NEXTAUTH_SECRET`.

### B.2 Root cause of "PDF of sign-in page"

`src/proxy.ts` (lines 27-43) defines `isPublicPath`:

```ts
const isPublicPath =
  path === '/' || path === '/preview' || path === '/about' ||
  path === '/morning-brief' || path === '/live-feed' ||
  path === '/trends' || path === '/company' ||
  path.startsWith('/watchlist/') ||
  path.startsWith('/auth/callback') ||
  path.startsWith('/api/');

if (!user && !isAuthPage && !isPublicPath) {
  const url = request.nextUrl.clone()
  url.pathname = '/auth'
  return NextResponse.redirect(url)
}
```

`/print/...` is **not in `isPublicPath`**. Puppeteer arrives without cookies, `user = null`, the redirect fires. `url.clone()` preserves the query string and only the pathname is overwritten, so Puppeteer ends up at `/auth?t=<HMAC>&type=morning&origin=<url>`. Puppeteer renders the sign-in page → PDF Title becomes `"Sign In — Signalera"`.

### B.3 Where "Auth session missing!" comes from

The string is logged by `src/lib/supabase-server.ts:29` inside `getSupabaseWithUser()` whenever `auth.getUser()` returns no user. Puppeteer's render of `/auth` mounts client trees that probe authenticated API routes (most likely `/api/user-profile` via `useUserProfile()` provider in any layout it inherits), each of which hits this helper without cookies and logs the error. It is the **noise from the wrong page being rendered**, not a separate auth bug.

### B.4 Even fixing the redirect is not enough

If we naively whitelist `/print/*` and let the existing service-role render through, Puppeteer would render the **canonical un-personalized brief**, missing:

1. User-specific section order (`shapeSections`)
2. User-specific sector_breakdown order (`shapeSectorBreakdown`)
3. `personalization.format_label` (used as headline fallback in web at `morning-brief/page.tsx:803`)
4. `user_addendum` block (rendered in web at `morning-brief/page.tsx:933-951`)

The architectural problem and the redirect problem are siblings, both rooted in "the print path has no user identity."

### B.5 Could we patch the HMAC scheme?

We could extend the HMAC payload to encode `user_id`, then look up the profile server-side and hand-shape sections inside `/print`. But that re-implements `/api/briefing` (a protected file) inside a parallel print path. Bespoke pattern Lucas/Noah maintain forever. **Reject.**

---

## C. Recommended auth approach

### Option 1 — Cookie forwarding + Bearer relay  ✅ CHOSEN

**Mechanism:**

1. **`src/proxy.ts`** — add `path.startsWith('/print/')` to `isPublicPath`. Cookies will still authenticate; the whitelist exists so onboarding-redirect logic doesn't intercept Puppeteer's render.
2. **`src/app/api/brief/export-pdf/route.ts`** — after authenticating the incoming request, extract the user's Supabase auth cookies (`sb-*-auth-token`, plus any `sb-*-auth-token-code-verifier` if present) via `request.cookies.getAll()`. After `puppeteer.launch()`, call `await page.setCookie(...mapped)` keyed to the print URL so Puppeteer arrives with the same session the browser used.
3. **`src/app/print/[briefing_id]/page.tsx`** — replace the service-role client with `createServerClient` + cookies (same pattern as `supabase-server.ts`). Read `session.access_token`, internally fetch `${origin}/api/briefing?type=morning|evening` with `Authorization: Bearer ${access_token}`. Render `PrintBrief` from the response. The HMAC token check becomes an optional belt-and-suspenders guard (Puppeteer can still pass `?t=` so a leaked URL without cookies cannot fetch a brief).
4. **Validation in export-pdf** (defense-in-depth):
   - After `page.goto`, assert `page.url()` did not redirect to `/auth`.
   - Assert `await page.title()` does not contain `"Sign In"`, `"404"`, `"Error"`.
   - Assert `await page.$('[data-print-brief-root]')` returns non-null (selector added to PrintBrief root).
   - On any failure: return HTTP 500 with descriptive error body. **Never** return HTTP 200 with a PDF of an error page.

**Pros:**
- Exact parity with the web UI's auth flow — same `/api/briefing` call, same Bearer token, same reshaping.
- No protected files modified (`/api/briefing/route.ts` is consumed, not edited).
- HMAC token becomes optional/redundant; cookies are real auth.
- Triple-layered failure detection (URL, title, DOM marker) closes the silent-200 hole.

**Cons:**
- Cookie domain handling: Puppeteer's `setCookie({ url })` form sets domain from the URL — works in dev (`http://localhost:3000`) and prod (`https://*.vercel.app`). Manual domain attribute is risky; using URL-anchored form is safer.
- `/api/briefing` returns user-shaped data — we now run that internal fetch on every PDF export. Negligible cost (single Supabase call already running for the web view).

### Option 2 — Service-role render with signed user_id param  ❌ NOT CHOSEN

Requires either re-implementing Lucas's reshaping logic in `/print` (forbidden — duplicates protected file) or refactoring `/api/briefing` to accept service-role + user_id (forbidden — modifies protected file). Also opens a covert-channel risk if the user_id signature scheme is weak.

### Option 3 — Patch HMAC + harden `/print` service-role path  ❌ NOT CHOSEN

Bespoke pattern. Encoding user identity into a signed token re-invents Supabase session auth. Still requires the proxy whitelist. Doesn't reach feature parity without duplicating protected logic.

---

## D. Integration plan with current personalization

| Surface | Web UI today | PDF after fix |
|---|---|---|
| Briefing endpoint | `/api/briefing?type=...` with Bearer | Same `/api/briefing?type=...` with Bearer (relay) |
| Section order | Reshaped per user role | Same |
| Sector_breakdown order | Reshaped per user sectors | Same |
| `personalization.format_label` | Used as headline fallback | Same — render via PrintBrief addition |
| `user_addendum` (V4B) | Rendered if non-null; soft-hidden if null | Render if non-null; soft-hidden if null (matches web) |
| Watchlist baking (PR #103) | Already in shared brief content | Same — comes from same briefing row |
| VIX, theses count, top stories | Direct queries with anon/cookie auth | Same — already implemented in `/print` |

If V4B addendum is missing in prod (`user_briefings.addendum does not exist`), **both web and PDF render the brief with no addendum block**. Parity is automatic — there's nothing to fix in the PDF path.

---

## E. Risks and open questions

1. **Supabase auth cookie names.** Production uses `sb-<project_ref>-auth-token` (chunked into `.0`, `.1` for large sessions). Forwarding strategy: filter `request.cookies.getAll()` to anything matching `^sb-` and forward all of them. Tested at runtime — if missing, the `/print` server-component will get no session and the validation guard catches the bad render.
2. **Internal fetch URL.** `/print` server component must hit `/api/briefing` on the same origin. Use `process.env.NEXT_PUBLIC_SITE_URL` in prod, fall back to `?origin=` query param Puppeteer already passes. Already plumbed.
3. **Print route public visibility.** Whitelisting `/print/*` means any unauthenticated visitor with a briefing_id can hit the route. Mitigations:
   - Server-component refuses to render if no session (`createServerClient` returns no user → return `notFound()`).
   - Existing HMAC-token check stays as defense-in-depth (require both cookie + token to render, or accept either depending on Puppeteer source).
   - `noindex` metadata stays on `print/layout.tsx`.
4. **Vercel preview SSO cookie.** Preview deploys are gated by Vercel's deployment protection. If Puppeteer needs to hit a preview URL, the `VERCEL_PROTECTION_BYPASS` cookie/header is documented in HANDOFF.md. The current implementation only handles same-deploy navigation (Puppeteer hits the same origin the user requested), so this is not a concern in normal user flow. Flag for future.
5. **Cold start cost.** chromium-min downloads the binary on first invocation (`v147.0.2-pack.x64.tar`). Existing implementation already incurs this. Not changed by the auth fix.
6. **Migration follow-up (out of scope here).** `supabase/migrations/20260416_create_user_briefings.sql` is present but apparently never applied to prod. Coordinate with Lucas before applying — addendum will start populating automatically once schema lands.

---

## F. Proceeding to implementation

Conditions checked:
- (a) Personalization end-to-end is mapped — synthesis (PR #103), read-time (`/api/briefing`), addendum (V4B partial). ✅
- (b) Chosen approach (Option 1) does not modify any protected file. ✅
- (c) No backend synthesis changes required. ✅

Implementing in this session against `feat/pdf-rebuild-v1` (no rebase, additive commits).
