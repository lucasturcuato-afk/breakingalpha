import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { checkFixedWindow, clientKeyFromHeaders } from "@/lib/rate-limit";
import { registerWaitlist } from "@/lib/waitlist-register";

// Client-callable entry point for the shared waitlist register. The email/
// password paths (landing modal + /auth fallback) POST here after signUp and on
// a non-approved sign-in so a non-approved user gets a waitlist row + our email
// immediately, independent of Supabase's confirmation-link delivery.
//
// Safe to call from the client: it only ever adds a NON-approved email to the
// waitlist or reports approved. It never admits anyone. The allowlist gate and
// service-role writes live entirely server-side in registerWaitlist.
//
// A coarse per-IP fixed-window throttle limits enumeration of allowlist
// membership from the { approved } response.
const REGISTER_RATE_LIMIT = 20;
const REGISTER_RATE_WINDOW_MS = 60_000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  const rl = checkFixedWindow(
    `waitlist-register:${clientKeyFromHeaders(request.headers)}`,
    REGISTER_RATE_LIMIT,
    REGISTER_RATE_WINDOW_MS,
  );
  if (!rl.allowed) {
    return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
  }

  let body: { email?: unknown; name?: unknown; source?: unknown };
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

  const result = await registerWaitlist({ email, name, source });
  return NextResponse.json(result);
}
