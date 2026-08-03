import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Ownership guard for client-initiated writes to `theses`.
 *
 * Both /api/thesis-detail and /api/thesis-regenerate persist LLM-derived
 * enrichment (title, rationale, catalyst_note, evidence_chain) back onto a
 * thesis row using the CALLER'S session client. Neither checked ownership, so
 * any authenticated user could rewrite the title and rationale of a
 * pipeline-generated thesis that every other user sees. All 57 live theses are
 * pipeline rows (user_id IS NULL), so in practice every write these routes
 * could perform was a write to shared content.
 *
 * Rules, matching the posture sql/0020_radar_rls_hardening.sql applies at the
 * database level:
 *  - system rows (user_id IS NULL) are pipeline-owned and immutable from the
 *    client. Enrichment may still be COMPUTED and returned to the caller; it
 *    just is not written back to the shared row.
 *  - a row owned by someone else is a hard 403.
 *  - the caller's own row is writable.
 *
 * Returning a discriminated result rather than throwing keeps the routes free
 * to still return their generated content on a refusal.
 */

export type ThesisWriteDecision =
  | { allowed: true }
  | { allowed: false; status: 403 | 404; reason: string };

export async function canWriteThesis(
  supabase: SupabaseClient,
  thesisId: string,
  userId: string,
): Promise<ThesisWriteDecision> {
  const { data, error } = await supabase
    .from("theses")
    .select("id, user_id")
    .eq("id", thesisId)
    .maybeSingle();

  if (error || !data) {
    return { allowed: false, status: 404, reason: "Thesis not found" };
  }
  if (data.user_id === null) {
    return {
      allowed: false,
      status: 403,
      reason: "System theses are pipeline-owned and cannot be edited",
    };
  }
  if (data.user_id !== userId) {
    return { allowed: false, status: 403, reason: "Forbidden" };
  }
  return { allowed: true };
}
