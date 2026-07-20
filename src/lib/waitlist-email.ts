/**
 * Server-side waitlist confirmation email.
 *
 * When a non-approved email lands on the waitlist, we send a single
 * transactional confirmation via Resend, then stamp notified_at on that row.
 * This is called ONLY from /auth/callback (see src/app/auth/callback/route.ts),
 * after the user has clicked the Supabase confirmation link and proven they own
 * the address. The signup endpoint never sends. Rules held to deliberately:
 *
 * - Idempotent: we only send when the row exists and notified_at is null, and
 *   we only set notified_at AFTER a successful send. Repeat confirmations never
 *   double-email.
 * - Reports entry state: returns { alreadyNotified }. true means notified_at was
 *   already set at entry and we skipped the send (the caller shows the
 *   already-on-the-list variant). false means notified_at was null and we
 *   attempted the send (the caller shows the standard variant). This is the
 *   single source of the existing-vs-new routing, keyed on the notified_at
 *   guard rather than on whether a row already existed.
 * - Non-blocking and fail-safe: this never throws to the caller. A send
 *   failure must not lose the signup or change the /waitlist redirect.
 * - If RESEND_API_KEY is missing, we skip the send silently and log it, so the
 *   flow works before the signalera.ai sending domain is verified. The
 *   notified_at read still runs first, so alreadyNotified stays correct locally.
 *
 * Never call this from the client. The Resend init mirrors
 * src/app/api/brief/send-email/route.ts.
 */

import { Resend } from "resend";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUBJECT = "You're early";
const HEADING = "You're on the list.";
const P1 = "Every model can summarize the market. None of them keep score.";
const P2 =
  "That is the part we are building. Signalera makes falsifiable calls, reviews them against real evidence, and leaves the ones that did not hold on the record. The calls you make get reviewed exactly the same way ours are.";
const P3 =
  "And it all lives in one place. Not another tab beside twelve others, three newsletters, and a feed that forgets you every morning. The morning read, the deal flow, the company work, the record. One place that already knows what you follow.";
const P4 =
  "Access opens in small waves so we can onboard people properly. We will reach out when yours is ready.";
const P5 =
  "Most tools are the same on day one hundred as they were on day one. This one is not. Every call you track teaches it what matters to you.";
const SIGNOFF = "The Signalera Team";
const CLOSING = "Reply to this email if you believe you should already have access.";
const FOOTER = "Informational only. Not investment advice.";

const TEXT_BODY = [HEADING, P1, P2, P3, P4, P5, SIGNOFF, CLOSING, FOOTER].join(
  "\n\n",
);

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
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e3dac6;border-radius:12px;padding:36px 32px;">
      <div style="font-size:22px;font-weight:700;margin-bottom:26px;">
        Signal<span style="color:#ae843a;">era.</span>
      </div>
      <h1 style="font-size:21px;font-weight:700;line-height:1.3;margin:0 0 22px;color:#1a1712;">${HEADING}</h1>
      <p style="font-size:17px;font-weight:600;line-height:1.55;margin:0 0 20px;color:#1a1712;">${P1}</p>
      <p style="font-size:15px;line-height:1.65;margin:0 0 16px;">${P2}</p>
      <p style="font-size:15px;line-height:1.65;margin:0 0 16px;">${P3}</p>
      <p style="font-size:15px;line-height:1.65;margin:0 0 16px;">${P4}</p>
      <p style="font-size:15px;line-height:1.65;margin:0 0 16px;">${P5}</p>
      <p style="font-size:15px;font-weight:600;line-height:1.6;margin:30px 0 0;color:#1a1712;">${SIGNOFF}</p>
      <p style="font-size:15px;line-height:1.6;margin:18px 0 0;color:#7a7060;">${CLOSING}</p>
      <hr style="border:none;border-top:1px solid #e3dac6;margin:26px 0 0;" />
      <p style="font-size:12px;line-height:1.5;color:#7a7060;margin:20px 0 0;">${FOOTER}</p>
    </div>
  </body>
</html>`;
}

/**
 * Send the waitlist confirmation email for `email` if it has not been sent yet,
 * then stamp notified_at. Always resolves; never throws.
 *
 * Returns { alreadyNotified }: true when the row was already notified at entry
 * (send skipped), false when notified_at was null and we attempted the send.
 * The notified_at read runs BEFORE the RESEND_API_KEY guard so alreadyNotified
 * reflects the true entry state even locally (where the key is absent and the
 * dispatch itself is skipped). Any error/skip path returns alreadyNotified:false
 * so the caller falls back to the standard (non-existing) redirect.
 */
export async function sendWaitlistConfirmationEmail(
  email: string,
): Promise<{ alreadyNotified: boolean }> {
  try {
    const normalized = email.trim().toLowerCase();
    if (!normalized) return { alreadyNotified: false };

    const admin = makeServiceClient();
    if (!admin) {
      console.warn(
        "[waitlist-email] Supabase env missing; cannot verify notified_at, skipping send",
      );
      return { alreadyNotified: false };
    }

    // Idempotency guard: read notified_at FIRST. This is the single source of
    // the existing-vs-new routing and of the no-resend guarantee. Reading before
    // the RESEND key check keeps alreadyNotified correct even when the key is
    // absent (local) and the dispatch is skipped.
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
      return { alreadyNotified: false };
    }
    if (!row) {
      console.warn(
        `[waitlist-email] no waitlist row for ${normalized}; skipping send`,
      );
      return { alreadyNotified: false };
    }
    if (row.notified_at) {
      // Already emailed. Do not double-send. Caller shows the existing variant.
      return { alreadyNotified: true };
    }

    // notified_at is null: this is a first-time confirmer. Attempt the send.
    if (!process.env.RESEND_API_KEY) {
      console.warn(
        `[waitlist-email] RESEND_API_KEY missing; skipping confirmation send for ${normalized}`,
      );
      return { alreadyNotified: false };
    }

    // Share one from-address variable with src/app/api/brief/send-email/route.ts.
    // EMAIL_FROM_ADDRESS is the canonical var set in Vercel; keep a local-dev
    // fallback default.
    const from =
      process.env.EMAIL_FROM_ADDRESS ?? "Signalera <noreply@signalera.ai>";

    let resend: Resend;
    try {
      resend = new Resend(process.env.RESEND_API_KEY);
    } catch (e) {
      console.error("[waitlist-email] resend init failed; skipping send:", e);
      return { alreadyNotified: false };
    }

    const result = await resend.emails.send({
      from,
      to: [normalized],
      replyTo: process.env.EMAIL_REPLY_TO ?? "admin@signalera.ai",
      subject: SUBJECT,
      text: TEXT_BODY,
      html: renderHtml(),
    });

    if (result.error) {
      console.error("[waitlist-email] resend send error:", result.error);
      return { alreadyNotified: false };
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

    // We attempted a send for a first-time confirmer (notified_at was null).
    return { alreadyNotified: false };
  } catch (e) {
    // Fail-safe: the signup must survive any error here.
    console.error(
      "[waitlist-email] unexpected failure; waitlist signup preserved:",
      e,
    );
    return { alreadyNotified: false };
  }
}
