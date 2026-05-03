/**
 * One-click unsubscribe endpoint for the Morning Brief email.
 *
 * GET  /api/unsubscribe?token=...   user-clicked link from the footer.
 *                                   Verifies HMAC, flips the user's
 *                                   brief_email_subscribed flag to false,
 *                                   returns a small HTML confirmation
 *                                   page with a "resubscribe" button.
 *
 * POST /api/unsubscribe             Gmail bulk-sender one-click handler
 *                                   per RFC 8058. Same effect, returns
 *                                   200 with a tiny JSON body. Token
 *                                   may arrive in body or in querystring.
 *
 * The HMAC verifier (verifyUnsubscribeToken) is timing-safe and binds to
 * a per-domain namespace so tokens from other features (PDF print, etc.)
 * cannot be replayed here.
 *
 * Auth: NONE. The token IS the auth   that's the point of one-click
 * unsubscribe. No Supabase session is required and likely won't exist
 * (recipients click from their inbox, not from a logged-in tab).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyUnsubscribeToken } from "@/lib/email/unsubscribe-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Supabase URL / key not configured");
  }
  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

async function setSubscribed(
  userId: string,
  subscribed: boolean,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = getServiceClient();
    const { error } = await supabase
      .from("user_profiles")
      .update({ brief_email_subscribed: subscribed })
      .eq("id", userId);
    if (error) {
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

function htmlPage(opts: {
  ok: boolean;
  resubscribed?: boolean;
  token: string | null;
  message?: string;
}): string {
  const { ok, resubscribed, token, message } = opts;
  const title = ok
    ? resubscribed
      ? "You're resubscribed"
      : "You're unsubscribed"
    : "Something went wrong";
  const body = ok
    ? resubscribed
      ? "You will continue to receive the Signalera Morning Brief."
      : "You will no longer receive the Signalera Morning Brief. Changed your mind?"
    : message ||
      "We couldn't process that link. It may have expired or been altered. Please email admin@signalera.ai for help.";
  // Resubscribe button reuses the same token (which never expires).
  const showResub = ok && !resubscribed && token;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>${title} | Signalera</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 48px 24px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      background: #fbf8f1;
      color: #1f1a14;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      max-width: 480px;
      width: 100%;
      background: #ffffff;
      border: 1px solid #e7dec8;
      border-radius: 12px;
      padding: 40px 32px;
      text-align: center;
      box-shadow: 0 8px 24px rgba(31, 26, 20, 0.04);
    }
    .brand {
      font-family: Georgia, "Times New Roman", serif;
      font-size: 24px;
      color: #c9922a;
      margin: 0 0 4px 0;
      letter-spacing: 0.5px;
    }
    .label {
      font-size: 10px;
      letter-spacing: 2px;
      color: #6b6458;
      text-transform: uppercase;
      font-weight: 700;
      margin: 0 0 24px 0;
    }
    h1 {
      font-family: Georgia, "Times New Roman", serif;
      font-size: 22px;
      margin: 0 0 12px 0;
      color: #1f1a14;
    }
    p {
      font-size: 14px;
      line-height: 1.55;
      color: #1f1a14;
      margin: 0 0 24px 0;
    }
    form { margin: 0; }
    button {
      appearance: none;
      border: 1px solid #c9922a;
      background: #c9922a;
      color: #ffffff;
      font-family: inherit;
      font-size: 13px;
      font-weight: 600;
      padding: 10px 20px;
      border-radius: 6px;
      cursor: pointer;
      letter-spacing: 0.3px;
    }
    button:hover { background: #b8841f; border-color: #b8841f; }
    .foot {
      margin-top: 24px;
      font-size: 11px;
      color: #6b6458;
    }
    .foot a { color: #6b6458; text-decoration: underline; }
  </style>
</head>
<body>
  <div class="card">
    <p class="brand">Signalera</p>
    <p class="label">Email Preferences</p>
    <h1>${title}</h1>
    <p>${body}</p>
    ${
      showResub
        ? `<form method="POST" action="/api/unsubscribe?action=resubscribe&amp;token=${encodeURIComponent(
            token!,
          )}">
            <button type="submit">Resubscribe</button>
          </form>`
        : ""
    }
    <p class="foot">
      Questions? <a href="mailto:admin@signalera.ai">admin@signalera.ai</a>
    </p>
  </div>
</body>
</html>`;
}

function htmlResponse(html: string, status = 200): NextResponse {
  return new NextResponse(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = request.nextUrl.searchParams.get("token");
  const action = request.nextUrl.searchParams.get("action");
  if (!token) {
    return htmlResponse(
      htmlPage({ ok: false, token: null, message: "Missing token." }),
      400,
    );
  }

  const userId = verifyUnsubscribeToken(token);
  if (!userId) {
    return htmlResponse(
      htmlPage({ ok: false, token: null, message: "Invalid or expired link." }),
      400,
    );
  }

  // GET with action=resubscribe is unusual (the resubscribe button POSTs)
  // but we handle it for completeness.
  const subscribed = action === "resubscribe";
  const result = await setSubscribed(userId, subscribed);
  if (!result.ok) {
    console.error("[unsubscribe] update failed:", result.error);
    return htmlResponse(
      htmlPage({
        ok: false,
        token,
        message:
          "We couldn't update your preferences right now. Please try again.",
      }),
      500,
    );
  }
  return htmlResponse(
    htmlPage({ ok: true, resubscribed: subscribed, token }),
    200,
  );
}

/**
 * Gmail / RFC 8058 one-click POST handler.
 *
 * The List-Unsubscribe-Post header advertises this. Receiving clients
 * (Gmail, Apple Mail) hit this with no body sometimes, body sometimes.
 * Token comes from the querystring (which mirrors the URL in the
 * List-Unsubscribe header).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const token = request.nextUrl.searchParams.get("token");
  const action = request.nextUrl.searchParams.get("action");
  if (!token) {
    return NextResponse.json({ ok: false, error: "missing token" }, {
      status: 400,
    });
  }
  const userId = verifyUnsubscribeToken(token);
  if (!userId) {
    return NextResponse.json({ ok: false, error: "invalid token" }, {
      status: 400,
    });
  }

  const subscribed = action === "resubscribe";
  const result = await setSubscribed(userId, subscribed);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, {
      status: 500,
    });
  }

  // If the POST came from the resubscribe form (browser), serve HTML so
  // the user sees the confirmation page. Mail-client one-click POSTs
  // expect a 2xx; the JSON body is ignored.
  const accept = request.headers.get("accept") || "";
  if (accept.includes("text/html")) {
    return htmlResponse(
      htmlPage({ ok: true, resubscribed: subscribed, token }),
      200,
    );
  }
  return NextResponse.json({ ok: true, subscribed }, { status: 200 });
}
