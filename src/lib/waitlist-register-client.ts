/**
 * Client-side helper for the shared waitlist register endpoint.
 *
 * Thin fetch wrapper over POST /api/waitlist/register so the landing modal and
 * the /auth fallback share one call site. All allowlist/waitlist/email logic
 * lives server-side in src/lib/waitlist-register.ts; this only relays the
 * approved / duplicate decision. Never throws: on any network/HTTP failure it
 * resolves to null and the caller fails safe (still routes to /waitlist, which
 * the proxy gate also enforces).
 */

export type WaitlistRegisterClientResult = {
  approved: boolean;
  duplicate?: boolean;
};

export async function postWaitlistRegister(
  email: string,
  source: string,
): Promise<WaitlistRegisterClientResult | null> {
  try {
    const res = await fetch("/api/waitlist/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, source }),
    });
    if (!res.ok) return null;
    return (await res.json()) as WaitlistRegisterClientResult;
  } catch {
    return null;
  }
}
