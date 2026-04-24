/**
 * HMAC-signed tokens for the print route.
 *
 * The `/print/[briefing_id]` route is meant to be consumed by the
 * Puppeteer process inside `/api/brief/export-pdf`, not by end users.
 * Rather than forward Supabase cookies into the headless Chromium
 * context (brittle with same-origin fetch on Vercel), the export route
 * mints a short-lived HMAC token over the briefing id, and the print
 * page verifies it before rendering.
 *
 * This keeps `/print/[id]` server-side render-only with no cookie
 * plumbing and no public exposure of briefing content. Tokens default
 * to 15 minutes which is ample for a single PDF render (~3–6s) with
 * cold-start headroom (~10s) to spare.
 *
 * Secret source priority:
 *   1. PDF_PRINT_SECRET (dedicated)
 *   2. SUPABASE_SERVICE_ROLE_KEY (always set in server env)
 *   3. NEXTAUTH_SECRET (fallback, may not exist in this repo)
 *
 * If NONE are set we refuse to mint — better to fail loudly than
 * accidentally ship an unsigned export route to prod.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_TTL_SECONDS = 15 * 60;

function getSecret(): string {
  const secret =
    process.env.PDF_PRINT_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXTAUTH_SECRET ||
    "";
  if (!secret) {
    throw new Error(
      "PDF print token secret is not configured. Set PDF_PRINT_SECRET or rely on SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  return secret;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
}

/**
 * Mint a `{briefing_id}.{exp_epoch}.{sig}` token. Exp is seconds since
 * epoch. Base64url so it's URL-safe without percent-encoding.
 */
export function mintPrintToken(
  briefingId: string,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): string {
  if (!briefingId) throw new Error("mintPrintToken: briefingId required");
  const secret = getSecret();
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${briefingId}.${exp}`;
  const sig = sign(payload, secret);
  return `${payload}.${sig}`;
}

export interface VerifiedPrintToken {
  briefingId: string;
  exp: number;
}

/**
 * Verify a token. Returns the parsed payload on success, `null` if the
 * token is malformed, expired, signed for a different briefing id, or
 * has an invalid signature. Constant-time comparison on the signature.
 */
export function verifyPrintToken(
  token: string | null | undefined,
  expectedBriefingId: string,
): VerifiedPrintToken | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [briefingId, expRaw, sig] = parts;
  if (!briefingId || !expRaw || !sig) return null;
  if (briefingId !== expectedBriefingId) return null;
  const exp = Number.parseInt(expRaw, 10);
  if (!Number.isFinite(exp)) return null;
  if (Math.floor(Date.now() / 1000) > exp) return null;

  let secret: string;
  try {
    secret = getSecret();
  } catch {
    return null;
  }
  const expected = sign(`${briefingId}.${exp}`, secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length) return null;
  try {
    if (!timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  return { briefingId, exp };
}
