import type { SupabaseClient } from "@supabase/supabase-js";

// Phase 1 stub aligns with substrate Step 3 enum values.
// 'memo' covers both type==='company' (article-grounded) and type==='company-web'
// (web fallback) for the v0 stub. Variant is encoded into metadata.variant.
export type OutputType =
  | "memo"
  | "brief"
  | "brief_section"
  | "brief_cluster"
  | "chat_answer"
  | "thesis"
  | "thesis_grade"
  | "contrarian_signal"
  | "deal_extraction"
  | "user_addendum"
  | "mention_alert"
  | "cross_reference";

export interface RecordOutputPayload {
  output_type: OutputType;
  source_table: string;
  source_id: string;
  prompt_inputs?: Record<string, unknown>;
  latency_ms?: number;
  metadata?: Record<string, unknown>;
}

// recordOutput inserts a single row into output_log_v0_stub.
// LOCKED Decision 4: stub naming preserves Lucas's eventual canonical Step 3
// schema. Single import + insert target change to repoint at canonical lock-in.
// Internal try/catch keeps after() callers from leaking exceptions into the
// request lifecycle (Pattern A guarantee).
export async function recordOutput(
  supabase: SupabaseClient,
  payload: RecordOutputPayload,
): Promise<{ id: string } | null> {
  try {
    const { data, error } = await supabase
      .from("output_log_v0_stub")
      .insert({
        output_type: payload.output_type,
        source_table: payload.source_table,
        source_id: payload.source_id,
        prompt_inputs: payload.prompt_inputs ?? null,
        latency_ms: payload.latency_ms ?? null,
        metadata: payload.metadata ?? null,
      })
      .select("id")
      .single();
    if (error) {
      console.error("[outputs] insert failed:", error.message);
      return null;
    }
    return { id: data.id as string };
  } catch (err) {
    console.error(
      "[outputs] insert threw:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}
