/**
 * Emails that bypass rate limits. Used by /api/memo and /api/intelligence.
 * Add/remove admins by editing this list and redeploying.
 */
export const ADMIN_EMAILS = new Set([
  "lucasturcuato@gmail.com",
  "noahhanning03@gmail.com",
]);

/**
 * Check if a user email is an admin (case-insensitive).
 */
export function isAdmin(email: string | undefined | null): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.has(email.toLowerCase());
}
