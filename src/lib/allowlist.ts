import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Beta allowlist check, shared by the OAuth callback, the proxy gate, and the
 * password sign-in path so the logic stays identical everywhere.
 *
 * Fails closed: any query error (including RLS denial or network failure)
 * returns false, i.e. NOT allowlisted. Callers must treat false as "deny".
 *
 * Matches the callback's lowercase logic: the email is normalized to lower case
 * before the equality lookup. Allowlist rows are stored lowercased and there is
 * a case-insensitive unique index on lower(email), so an exact eq on the
 * normalized value is correct.
 *
 * The query reads a single row keyed by email. Under RLS policy
 * allowlist_read_self an authenticated user may SELECT only their own row
 * (lower(email) = lower(jwt email)), which is exactly the row we look up, so no
 * service role is required from the proxy or the browser client.
 */
export async function isAllowlisted(
  supabase: SupabaseClient,
  email: string | null | undefined,
): Promise<boolean> {
  if (!email) return false
  const normalized = email.toLowerCase()

  const { data, error } = await supabase
    .from('beta_allowlist')
    .select('email')
    .eq('email', normalized)
    .maybeSingle()

  if (error) {
    // Fail closed: if we cannot verify, do not let them in.
    console.error('Allowlist check error:', error.message)
    return false
  }

  return Boolean(data)
}
