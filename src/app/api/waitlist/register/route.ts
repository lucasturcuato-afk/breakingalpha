import { NextResponse, after } from "next/server";
import type { NextRequest } from "next/server";
import { checkFixedWindow, clientKeyFromHeaders } from "@/lib/rate-limit";
import { registerWaitlist } from "@/lib/waitlist-register";
import { parseCohortFromBody } from "@/lib/cohort";

// Client-callable entry point for the shared waitlist register. The email/
// password paths (landing modal + /auth fallback) POST here after signUp and on
// a non-approved sign-in so a non-approved user gets a waitlist row captured
// immediately, independent of Supabase's confirmation-link delivery.
//
// This endpoint sends NOTHING. registerWaitlist only captures the row; the
// confirmation email is deferred to /auth/callback (proven email ownership), so
// entering a third party's address at signup cannot cause us to email them.
//
// Safe to call from the client, and it does NOT leak allowlist membership: the
// response body and status are a CONSTANT { ok: true } / 200 regardless of
// whether the email is approved, non-approved-new, or non-approved-duplicate.
// An unauthenticated caller therefore cannot enumerate the private beta from
// this endpoint. The allowlist gate and service-role writes live entirely
// server-side in registerWaitlist; the endpoint simply stops forwarding the
// status to the caller.
//
// Timing is status-independent: registerWaitlist (allowlist read + the
// non-approved upsert) runs as post-response work via after(), so the response
// returns immediately in both cases and latency does not vary by allowlist
// status. after() keeps the function alive until the write completes, so the
// waitlist row still reliably lands.
//
// A coarse per-IP fixed-window throttle stays in place as a general abuse guard.
const REGISTER_RATE_LIMIT = 20;
const REGISTER_RATE_WINDOW_MS = 60_000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  const rl = await checkFixedWindow(
    `waitlist-register:${clientKeyFromHeaders(request.headers)}`,
    REGISTER_RATE_LIMIT,
    REGISTER_RATE_WINDOW_MS,
  );
  if (!rl.allowed) {
    return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
  }

  let body: {
    email?: unknown;
    name?: unknown;
    source?: unknown;
    cohort_source?: unknown;
    cohort_institution?: unknown;
    cohort_batch?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name : null;
  const source = typeof body.source === "string" ? body.source : "waitlist_register";

  // Cohort attribution. This endpoint is UNAUTHENTICATED and client-callable,
  // so everything here is attacker-controlled: parseCohortFromBody validates the
  // source against a closed enum and normalizes the two slugs, yielding null for
  // anything it does not recognize. Free text is never stored. An invalid cohort
  // is silently dropped rather than rejected, because a bad attribution tag must
  // never cost someone their waitlist row.
  const cohort = parseCohortFromBody(body);

  // Run the register (allowlist read + non-approved upsert, no email) after the
  // response so it never varies response timing by allowlist status. after()
  // keeps the serverless function alive until this completes, so the write still
  // reliably happens. Never surface the { approved, duplicate } result to the
  // caller: the body is a constant regardless of status.
  after(async () => {
    try {
      await registerWaitlist({ email, name, source, cohort });
    } catch (e) {
      console.error("[waitlist-register] post-response register failed:", e);
    }
  });

  return NextResponse.json({ ok: true });
}
