/**
 * Client-side helper for the shared waitlist register endpoint.
 *
 * Thin fetch wrapper over POST /api/waitlist/register so the landing modal and
 * the /auth fallback share one call site. All allowlist/waitlist/email logic
 * lives server-side in src/lib/waitlist-register.ts.
 *
 * By design this returns NO allowlist status. The endpoint responds with a
 * constant { ok: true } / 200 whether the email is approved or not, so an
 * unauthenticated caller cannot enumerate the private beta. Callers must NOT
 * branch on the result to decide approval: signup always shows "check your
 * email", and sign-in decides via the authenticated isAllowlisted self-read.
 * This call exists only to ensure a non-approved user gets a waitlist row + our
 * email (idempotent server-side). Never throws: on any network/HTTP failure it
 * resolves to false and the caller fails safe (still routes to /waitlist, which
 * the proxy gate also enforces).
 */

export async function postWaitlistRegister(
  email: string,
  source: string,
): Promise<boolean> {
  try {
    const res = await fetch("/api/waitlist/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, source }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
