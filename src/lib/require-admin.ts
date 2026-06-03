// Server-only founders gate for the /internal analytics dashboard.
//
// This module must never be imported by a Client Component: it resolves the
// current user from the request cookies via getSupabaseWithUser() (which uses
// next/headers) and short-circuits rendering with notFound() from
// next/navigation. Both are server-only APIs, so a client import would fail to
// compile.
import { notFound } from "next/navigation";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { canAccessAdmin } from "@/lib/admin-emails";

/**
 * Gate a Server Component / route to founders only.
 *
 * Resolves the current user with the secure getUser() path and calls
 * notFound() (HTTP 404, fail-closed) when the user is missing or not on the
 * ADMIN_EMAILS allowlist. The 404 deliberately hides the page's existence from
 * non-admins. Returns the authenticated admin user on success.
 */
export async function requireAdmin() {
  const { user } = await getSupabaseWithUser();
  if (!canAccessAdmin(user)) {
    notFound();
  }
  return user!;
}
