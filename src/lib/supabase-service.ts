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
 * Service-role only: bypasses RLS, never expose to the browser. Fails loud when
 * SUPABASE_SERVICE_ROLE_KEY is unset rather than falling back to the anon key:
 * after the companies/aliases RLS lockdown an anon-key write is silently
 * rejected (insufficient_privilege), which surfaced as an opaque 500. A missing
 * key is a misconfiguration (e.g. an unset Vercel Preview scope), so we name it.
 */
let _serviceClient: SupabaseClient | null = null;

export function getServiceSupabase(): SupabaseClient {
  if (_serviceClient) return _serviceClient;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is required for getServiceSupabase(). Set it in this environment scope (including the Vercel Preview scope). Refusing to fall back to the anon key, which RLS rejects on write tables.",
    );
  }
  _serviceClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return _serviceClient;
}
