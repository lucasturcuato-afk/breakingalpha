import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Module-level service-role Supabase singleton.
 *
 * Built ONCE per server instance with autoRefreshToken:false and
 * persistSession:false. A default GoTrue client starts a retained ~30s token
 * auto-refresh setInterval on construction. Building a fresh client per request
 * (as the memo route did at 5 sites) leaked one undisposed ticker per client;
 * on reused serverless instances these accumulate and raise latency call over
 * call. A single reused client starts exactly one ticker, and
 * autoRefreshToken:false stops even that. Mirrors the module-level GoogleGenAI
 * singleton pattern.
 *
 * Service-role only: bypasses RLS, never expose to the browser. The anon-key
 * fallback preserves local-dev behavior when SUPABASE_SERVICE_ROLE_KEY is unset
 * (identical to the per-site expression this replaces).
 */
let _serviceClient: SupabaseClient | null = null;

export function getServiceSupabase(): SupabaseClient {
  if (_serviceClient) return _serviceClient;
  _serviceClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return _serviceClient;
}
