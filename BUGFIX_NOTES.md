# Bugfix Pass — 2026-04-25

Branch: `lucas/bugfix-pass-2026-04-25`

---

## Fix 1 — React #418 hydration mismatch on /evening-wrap (and /morning-brief)

**Root cause:** Both pages compute `const now = briefing?.created_at ? new Date(briefing.created_at) : new Date()` during render. The fallback `new Date()` yields different timestamps on the server (SSR) vs the client (hydration), triggering React warning #418.

**Fix:** Replaced the bare `new Date()` fallback with `useState(() => new Date())` so the value is created once and stays stable across the SSR-to-hydration boundary. Real briefings always carry `created_at`, so the fallback only guards a null edge case.

**Files changed:**
- `src/app/evening-wrap/page.tsx` (line ~395)
- `src/app/morning-brief/page.tsx` (line ~365)

---

## Fix 2 — user_briefings.addendum migration + null-safe read path

**Investigation result: NO CODE FIX NEEDED.**

The migration already exists at `supabase/migrations/20260416_create_user_briefings.sql`. The read path is already null-safe at every layer:

1. **API route** (`src/app/api/briefing/route.ts:311-338`): Query is wrapped in try/catch. If the `user_briefings` table doesn't exist or returns an error, it logs and returns `null`. The addendum value is checked with `typeof ... === "string"` before use.
2. **Frontend** (morning-brief line 241, evening-wrap line 261): `setUserAddendum` is only called when `typeof data.user_addendum === "string"`.
3. **Render** (morning-brief line 935, evening-wrap line 938): `userAddendum` is conditionally rendered only when truthy (`{userAddendum && (...)}`).

**For Lucas:** If the `user_briefings` table has not been created in production Supabase, run `supabase/migrations/20260416_create_user_briefings.sql` in the SQL editor. Until then, the addendum simply doesn't appear — no errors, no crashes.
