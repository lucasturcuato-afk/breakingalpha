import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Create a thesis OWNED BY the signed-in user.
 *
 * Every client-side "add to thesis" path used to insert with no `user_id`,
 * producing a row indistinguishable from a pipeline-generated system thesis
 * (`user_id IS NULL`). That had two consequences:
 *
 *  1. The row was unattributable. A user could create a thesis and it would sit
 *     in the shared system corpus rather than in their own workspace.
 *  2. It only worked because `theses` RLS was `USING (true)` for INSERT -- i.e.
 *     it depended on the table being world-writable. Once ownership policies
 *     are applied (sql/0020_theses_owner_rls.sql), an insert without `user_id`
 *     is correctly rejected.
 *
 * Stamping `user_id` fixes both, and makes these call sites forward-compatible
 * with the tightened policy. Unauthenticated callers get an explicit
 * "unauthenticated" result rather than silently writing an orphan row -- note
 * /morning-brief is a public route, so this path is reachable signed-out.
 */

export interface NewThesisFields {
  title: string;
  conviction?: string;
  sector?: string;
  rationale?: string;
  source?: string;
  status?: string;
  generated_at?: string;
}

export type CreateThesisResult =
  | { ok: true }
  | { ok: false; reason: "unauthenticated" | "failed"; message: string };

export async function createUserThesis(
  supabase: SupabaseClient,
  fields: NewThesisFields,
): Promise<CreateThesisResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      reason: "unauthenticated",
      message: "Sign in to save this to your tracked views.",
    };
  }

  const { error } = await supabase.from("theses").insert({
    ...fields,
    user_id: user.id,
  });

  if (error) {
    return { ok: false, reason: "failed", message: error.message };
  }
  return { ok: true };
}
