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

/**
 * Pure admin-gate decision used by requireAdmin() for the /internal dashboard.
 * Fail-closed: returns true only when a user object exists AND its email is on
 * the allowlist. A missing user, missing email, or non-allowlisted email all
 * return false. Kept dependency-free so it is unit-testable in isolation.
 */
export function canAccessAdmin(
  user: { email?: string | null } | null | undefined,
): boolean {
  return !!user && isAdmin(user.email);
}
