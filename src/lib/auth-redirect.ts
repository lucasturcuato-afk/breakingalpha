/**
 * auth-redirect.ts - where a user goes after signing in.
 *
 * The Morning Brief CTA is /radar/calls?adopt=<id>#call-<id>. Signed out, the
 * proxy bounces that to /auth?adopt=<id>, and before this module existed the
 * id died there: the auth page hardcoded window.location.href = "/dashboard"
 * on the password path, sent no `next` through the Google round trip, and the
 * OAuth callback hardcoded /dashboard too. Every emailed call link therefore
 * dumped a signed-out reader on the dashboard with no idea which call they had
 * clicked.
 *
 * Two things make this awkward and are handled here rather than at each call
 * site:
 *
 * 1. A URL fragment is NEVER sent to a server. #call-<id> cannot survive any
 *    server hop, so the anchor is synthesized from the adopt id instead of
 *    forwarded. callDestination() is the one place that shape is written.
 * 2. A `next` that we hand to a redirect is an open-redirect hole if it can
 *    point off-origin. safeNext() only ever returns a same-origin relative
 *    path.
 *
 * Pure. No React, no fetch, no Supabase.
 */

/** Where a signed-in user lands when the URL asked for nothing specific. */
export const POST_AUTH_DEFAULT = "/dashboard";

/**
 * Call ids are UUIDs. Validating before interpolating keeps arbitrary text out
 * of both the query string and the DOM id we anchor to.
 */
const CALL_ID = /^[A-Za-z0-9][A-Za-z0-9-]{5,63}$/;

/**
 * A relative, same-origin path, or null.
 *
 * Rejects absolute URLs ("https://evil.com"), protocol-relative ones
 * ("//evil.com"), and the backslash variant some browsers normalise into a
 * protocol-relative URL ("/\evil.com").
 */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/")) return null;
  if (next.startsWith("//") || next.startsWith("/\\")) return null;
  return next;
}

/** The one definition of "land on this call, with it scrolled into view". */
export function callDestination(adoptId: string): string {
  return `/radar/calls?adopt=${encodeURIComponent(adoptId)}#call-${adoptId}`;
}

/**
 * Resolve a post-auth destination from a query string.
 *
 * `adopt` wins over `next` because it is what the email actually sends and it
 * carries the anchor. Anything unrecognised falls back to the dashboard, so a
 * malformed link degrades to the old behaviour rather than to an error.
 */
export function postAuthDestination(search: string): string {
  const params = new URLSearchParams(search || "");
  const adopt = params.get("adopt");
  if (adopt && CALL_ID.test(adopt)) return callDestination(adopt);
  return safeNext(params.get("next")) ?? POST_AUTH_DEFAULT;
}
