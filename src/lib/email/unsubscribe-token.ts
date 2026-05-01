/**
 * unsubscribe-token.ts   HMAC-signed tokens for one-click email unsubscribe.
 *
 * The Morning Brief email's footer link points at
 *   /api/unsubscribe?token=<sign(user_id)>
 *
 * The token is a base64url-encoded "<user_id>.<hmac>" pair. HMAC keys off
 * SUPABASE_JWT_SECRET (preferred) or SUPABASE_SERVICE_ROLE_KEY (fallback)
 * with a fixed namespace string so the token is bound to the unsubscribe
 * domain and can never be replayed against another HMAC user (e.g. PDF
 * print tokens).
 *
 * No expiry: unsubscribe links live as long as the email itself, which can
 * be opened years later. CAN-SPAM expects the link to keep working for at
 * least 30 days; we honor that by letting it work forever.
 *
 * Verification is timing-safe via crypto.timingSafeEqual.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const NAMESPACE = "signalera:unsubscribe:v1";

function getSecret(): string {
  const s =
    process.env.SUPABASE_JWT_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "";
  if (!s) {
    // Better to refuse than mint forge-able tokens. The email send route
    // and the unsubscribe handler both surface the configuration gap.
    throw new Error(
      "Missing SUPABASE_JWT_SECRET (or SUPABASE_SERVICE_ROLE_KEY fallback) for unsubscribe token signing.",
    );
  }
  return s;
}

function sign(userId: string): string {
  const h = createHmac("sha256", getSecret());
  h.update(NAMESPACE);
  h.update(":");
  h.update(userId);
  // 16 bytes (128 bits) of HMAC truncation is plenty for a per-user
  // unsubscribe namespace and keeps URLs short.
  return h.digest("base64url").slice(0, 22);
}

function b64urlEncode(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}

function b64urlDecode(s: string): string {
  return Buffer.from(s, "base64url").toString("utf8");
}

/**
 * Returns a URL-safe token that proves the bearer knew the server's HMAC
 * secret AND the user_id at the time the email was rendered.
 */
export function makeUnsubscribeToken(userId: string): string {
  const mac = sign(userId);
  return b64urlEncode(`${userId}.${mac}`);
}

/**
 * Returns the user_id encoded in the token if and only if the HMAC matches.
 * Returns null on any failure   bad encoding, bad shape, bad signature.
 */
export function verifyUnsubscribeToken(token: string): string | null {
  try {
    const decoded = b64urlDecode(token);
    const dot = decoded.lastIndexOf(".");
    if (dot < 1 || dot === decoded.length - 1) return null;
    const userId = decoded.slice(0, dot);
    const mac = decoded.slice(dot + 1);
    const expected = sign(userId);
    // timingSafeEqual requires equal-length buffers
    const a = Buffer.from(mac, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length) return null;
    if (!timingSafeEqual(a, b)) return null;
    return userId;
  } catch {
    return null;
  }
}
