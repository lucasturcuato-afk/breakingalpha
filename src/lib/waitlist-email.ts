/**
 * Server-side waitlist confirmation email.
 *
 * When a non-approved email lands on the waitlist (see
 * src/app/auth/callback/route.ts), we send a single transactional confirmation
 * via Resend, then stamp notified_at on that row. Rules held to deliberately:
 *
 * - Idempotent: we only send when the row exists and notified_at is null, and
 *   we only set notified_at AFTER a successful send. Duplicate signups (the
 *   callback skips the insert on a duplicate) therefore never double-email.
 * - Non-blocking and fail-safe: this never throws to the caller. A send
 *   failure must not lose the signup or change the /waitlist redirect.
 * - If RESEND_API_KEY is missing, we skip the send silently and log it, so the
 *   flow works before the signalera.ai sending domain is verified.
 *
 * Never call this from the client. The Resend init mirrors
 * src/app/api/brief/send-email/route.ts.
 */

import { Resend } from "resend";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUBJECT = "You are on the Signalera list";
const BODY =
  "Signalera is in private beta, opening access in small waves. You are on the list, and we will reach out when your access is ready. If you believe you should already have access, reply to this note or email admin@signalera.ai.";
const FOOTER = "Informational only. Not investment advice.";

/**
 * Service-role Supabase client for the waitlist read/update. public.waitlist is
 * RLS-locked to service_role, so the notified_at check and stamp need this key.
 * Falls back to the anon key (the read/update will then be RLS-limited, and the
 * function soft-fails). Returns null if the env is absent.
 */
function makeServiceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function renderHtml(): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f5efe4;font-family:Arial,Helvetica,sans-serif;color:#1a1712;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e3dac6;border-radius:12px;padding:32px;">
      <div style="font-size:22px;font-weight:700;margin-bottom:20px;">
        Signal<span style="color:#ae843a;">era</span>
      </div>
      <p style="font-size:15px;line-height:1.6;margin:0 0 24px;">${BODY}</p>
      <hr style="border:none;border-top:1px solid #e3dac6;margin:24px 0;" />
      <p style="font-size:12px;line-height:1.5;color:#7a7060;margin:0;">${FOOTER}</p>
    </div>
  </body>
</html>`;
}

/**
 * Send the waitlist confirmation email for `email` if it has not been sent yet,
 * then stamp notified_at. Always resolves; never throws.
 */
export async function sendWaitlistConfirmationEmail(email: string): Promise<void> {
  try {
    const normalized = email.trim().toLowerCase();
    if (!normalized) return;

    if (!process.env.RESEND_API_KEY) {
      console.warn(
        `[waitlist-email] RESEND_API_KEY missing; skipping confirmation send for ${normalized}`,
      );
      return;
    }

    const admin = makeServiceClient();
    if (!admin) {
      console.warn(
        "[waitlist-email] Supabase env missing; cannot verify notified_at, skipping send",
      );
      return;
    }

    // Idempotency guard: only send when the row exists and has not been
    // notified. This is belt-and-suspenders on top of the callback skipping the
    // insert on a duplicate signup.
    const { data: row, error: readErr } = await admin
      .from("waitlist")
      .select("email, notified_at")
      .eq("email", normalized)
      .maybeSingle();

    if (readErr) {
      console.error(
        `[waitlist-email] could not read waitlist row for ${normalized}; skipping send:`,
        readErr.message,
      );
      return;
    }
    if (!row) {
      console.warn(
        `[waitlist-email] no waitlist row for ${normalized}; skipping send`,
      );
      return;
    }
    if (row.notified_at) {
      // Already emailed. Do not double-send.
      return;
    }

    const from = process.env.WAITLIST_FROM_EMAIL ?? "noreply@signalera.ai";

    let resend: Resend;
    try {
      resend = new Resend(process.env.RESEND_API_KEY);
    } catch (e) {
      console.error("[waitlist-email] resend init failed; skipping send:", e);
      return;
    }

    const result = await resend.emails.send({
      from,
      to: [normalized],
      replyTo: process.env.EMAIL_REPLY_TO ?? "admin@signalera.ai",
      subject: SUBJECT,
      text: `${BODY}\n\n${FOOTER}`,
      html: renderHtml(),
    });

    if (result.error) {
      console.error("[waitlist-email] resend send error:", result.error);
      return;
    }

    // Only stamp notified_at after a confirmed successful send. The
    // `is('notified_at', null)` predicate keeps concurrent sends idempotent.
    const { error: updateErr } = await admin
      .from("waitlist")
      .update({ notified_at: new Date().toISOString() })
      .eq("email", normalized)
      .is("notified_at", null);

    if (updateErr) {
      console.error(
        "[waitlist-email] send succeeded but failed to set notified_at:",
        updateErr.message,
      );
    }
  } catch (e) {
    // Fail-safe: the signup must survive any error here.
    console.error(
      "[waitlist-email] unexpected failure; waitlist signup preserved:",
      e,
    );
  }
}
