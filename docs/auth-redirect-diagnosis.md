# Auth redirect diagnosis — signalera.vercel.app → signalera.ai

**Symptom:** After Google OAuth sign-in on `https://signalera.ai`, users are redirected to the landing/opening page (`/`) instead of `/dashboard`.

## Smoking gun

The OAuth `redirectTo` is built **client-side from `window.location.origin`** (correct). The bug is almost certainly in the **Supabase Auth project configuration**: the Site URL + Redirect URLs allowlist still contains the old `*.vercel.app` host(s) and does **not** contain `https://signalera.ai`. When the requested `redirectTo` is not in the allowlist, Supabase substitutes its configured Site URL, sending the user back to the old domain — where cookies/redirects then land them on the OpeningScreen at `/` on the new domain.

## Where redirectTo is constructed

| Site                       | File                                              | Line | Source of origin              | Resolves to in prod (signalera.ai)         |
|----------------------------|---------------------------------------------------|------|-------------------------------|--------------------------------------------|
| Google OAuth (browser)     | `src/app/auth/page.tsx`                           | 72   | `window.location.origin`      | `https://signalera.ai/auth/callback`       |
| Email signup confirmation  | `src/app/auth/page.tsx`                           | 50   | `window.location.origin`      | `https://signalera.ai/auth/callback`       |
| Callback exchange + redir  | `src/app/auth/callback/route.ts`                  | 7    | `new URL(request.url).origin` | Whatever host the browser hit the route on |

Both client and server use the **request host**, not an env var. So if the user starts the flow on `signalera.ai`, the strings handed to Supabase are correct.

## Trace of the failing flow

1. User on `https://signalera.ai/auth` clicks "Continue with Google".
2. Browser POSTs to `https://<project>.supabase.co/auth/v1/authorize?…&redirect_to=https://signalera.ai/auth/callback`.
3. Supabase compares `redirect_to` against its configured **Redirect URLs allowlist**. `https://signalera.ai/**` is **not** in that list (the project was set up against `breakingalpha.vercel.app` per `docs/HANDOFF.md` line 254).
4. Supabase silently substitutes its **Site URL** as the post-auth target.
5. Old Site URL = `https://breakingalpha.vercel.app`. Two sub-cases:
   - **5a (most likely):** `breakingalpha.vercel.app` 308-redirects to `signalera.ai`. The browser lands on `https://signalera.ai/` → root page (`src/app/page.tsx`) renders `OpeningScreen` → user sees the **landing page**, no session cookie set on `signalera.ai`.
   - **5b:** The callback runs at `breakingalpha.vercel.app/auth/callback`, sets cookies scoped to `.vercel.app`, then redirects to `breakingalpha.vercel.app/dashboard` → Vercel domain redirect to `signalera.ai/dashboard` → **but cookies don't carry across domains** → `proxy.ts` sees no user → redirects to `/auth`. (User would see the sign-in form, not the OpeningScreen — so 5a is the match for the reported symptom.)

## Hypothesis check

| # | Hypothesis | Verdict | Evidence |
|---|------------|---------|----------|
| a | `NEXT_PUBLIC_SITE_URL` (or sibling) is set to `signalera.vercel.app` in Vercel and is being used by OAuth | **Eliminated for OAuth.** OAuth uses `window.location.origin` directly. `NEXT_PUBLIC_SITE_URL` is only referenced in `src/app/print/[briefing_id]/page.tsx:489` and `src/app/api/brief/export-pdf/route.ts:61` (PDF generation). | grep results below |
| b | Supabase Auth Site URL + Redirect URLs allowlist still on old domain | **Primary suspect.** Matches symptom exactly. Confirmed by `docs/HANDOFF.md:254` documenting Site URL = `https://breakingalpha.vercel.app`. | HANDOFF.md, trace above |
| c | `proxy.ts` (Next 16 middleware-equivalent) has hardcoded domain logic | **Eliminated.** `src/proxy.ts` uses `request.nextUrl.clone()` throughout — no hardcoded host strings. | Read of src/proxy.ts |
| d | Cookies scoped to `.vercel.app` and unreadable on signalera.ai | **Possible secondary effect** *only if* the callback ever runs on the wrong domain. Consequence of (b), not an independent cause. `@supabase/ssr` doesn't set an explicit cookie `domain`, so cookies are scoped to whatever host set them. | callback/route.ts cookie setter is host-agnostic |
| e | Google Cloud Console missing `signalera.ai` in Authorized JS Origins | **Eliminated.** Supabase brokers the OAuth dance. Google's redirect URI is fixed at `<project>.supabase.co/auth/v1/callback` regardless of the frontend domain. Frontend domain change cannot affect Google's allowlist. | OAuth code calls `signInWithOAuth({ provider: 'google' })` — no direct Google client |

## Other domain references found (not blockers, worth follow-up)

- `src/app/legal/privacy/page.tsx:22` — visible text "breakingalpha.vercel.app". Display only.
- `src/app/legal/terms/page.tsx:20` — visible text "breakingalpha.vercel.app". Display only.
- `src/app/api/brief/export-pdf/route.ts:61, 149` — `NEXT_PUBLIC_SITE_URL` fallback + cookie-domain comment referencing `*.vercel.app`. Affects PDF export, not auth.
- `src/app/print/[briefing_id]/page.tsx:489` — `NEXT_PUBLIC_SITE_URL` fallback. Same.
- `docs/HANDOFF.md:181, 206, 254, 571`, `.sprint-notes/brief-polish-handoff.md:11, 79`, `SPEC_pdf_auth_fix.md:138` — documentation only.

## Fix plan

### A. Supabase Auth dashboard (manual — Noah)
1. Open Supabase project → **Authentication → URL Configuration**.
2. Set **Site URL** to `https://signalera.ai`.
3. Under **Redirect URLs**, add (keep existing entries while migrating):
   - `https://signalera.ai/**`
   - `https://www.signalera.ai/**` (if `www` is also a registered domain)
   - `https://*.signalera-*.vercel.app/**` or your preview-deployment glob, so Vercel preview URLs continue to work for Google sign-in
4. Save. **No deploy needed; takes effect immediately.**

### B. Vercel env vars (manual — Noah)
1. Vercel project → **Settings → Environment Variables → Production**.
2. Update `NEXT_PUBLIC_SITE_URL` → `https://signalera.ai`. (Used by PDF/print only — won't fix OAuth, but will fix PDF link rendering.)
3. Verify there is no `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_BASE_URL`, or `NEXT_PUBLIC_VERCEL_URL` overriding values pinned to the old host (none referenced in code, but worth a glance in the dashboard).
4. Redeploy production after env changes.

### C. Google Cloud Console
**No changes required.** Supabase is the OAuth client; Google sees only the Supabase callback URL.

### D. Code changes
**No changes required for the OAuth bug.** `window.location.origin` already does the right thing.

Optional cleanup PRs (not blockers):
- `src/app/legal/privacy/page.tsx:22` — change display text from `breakingalpha.vercel.app` to `signalera.ai`.
- `src/app/legal/terms/page.tsx:20` — same.
- `src/app/api/brief/export-pdf/route.ts:149` — update the cookie-domain comment.
- `docs/HANDOFF.md:254` — update the Supabase URL config note once (A) is done.

### E. Verification (after A+B done)
1. Open `https://signalera.ai/auth` in a clean incognito window.
2. Click "Continue with Google", complete sign-in.
3. Expected: lands on `https://signalera.ai/dashboard` (not `/`, not `/auth`).
4. In DevTools → Application → Cookies, confirm Supabase auth cookies are set on `Domain=signalera.ai` (or `Domain=.signalera.ai` if Supabase opts to share with `www`).
5. Hard refresh `/dashboard` — must stay on `/dashboard`, not bounce to `/auth`.

## Risk if (A) is done but (B) is not
OAuth will work end-to-end (users land on `/dashboard`). PDF exports may render with wrong absolute URLs in their hrefs/og:url tags. Cosmetic, not a blocker.

## Risk if (B) is done but (A) is not
**OAuth still broken.** `NEXT_PUBLIC_SITE_URL` is not in the OAuth path; updating it changes nothing about Supabase's allowlist behavior.
