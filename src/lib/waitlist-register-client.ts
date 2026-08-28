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

import { isEmptyCohort, type Cohort } from "@/lib/cohort";

export async function postWaitlistRegister(
  email: string,
  source: string,
  cohort?: Cohort,
): Promise<boolean> {
  try {
    // Cohort fields are omitted entirely when nothing was captured, so a
    // cohort-less signup sends exactly the body it sends today. The server
    // re-validates against the closed enum regardless: this endpoint is
    // unauthenticated, so nothing arriving here is trusted.
    const body =
      cohort && !isEmptyCohort(cohort)
        ? {
            email,
            source,
            cohort_source: cohort.source,
            cohort_institution: cohort.institution,
            cohort_batch: cohort.batch,
          }
        : { email, source };
    const res = await fetch("/api/waitlist/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}
