/**
 * Universal output recorder. Writes to the `outputs` table for every
 * AI-generated output. Foundation for feedback collection and outcome grading.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Every value this codebase is allowed to write to `outputs.output_type`.
 *
 * THIS LIST IS A CLAIM ABOUT THE DATABASE, NOT A LOCAL PREFERENCE. The column
 * is `public.output_type_enum`. Postgres rejects any value that is not a member
 * with SQLSTATE 22P02, and supabase-js reports that in the result object rather
 * than throwing, so an unbacked entry here fails silently at runtime forever.
 *
 * That is exactly what happened to 'company_overview': it was added here with
 * no matching enum member, so every Coverage Primer cache write 22P02'd and
 * every page view re-billed a Gemini call.
 *
 * Adding an entry here REQUIRES a migration that adds the same value to
 * output_type_enum. `src/lib/outputs.enum.test.ts` enforces that against a
 * snapshot of the live enum captured from the database, so this list cannot
 * drift ahead of the schema again unnoticed.
 */
export const OUTPUT_TYPES = [
  'memo',
  'brief',
  'brief_section',
  'brief_cluster',
  'chat_answer',
  'thesis',
  'thesis_grade',
  'contrarian_signal',
  'deal_extraction',
  'user_addendum',
  'mention_alert',
  'cross_reference',
  'company_overview',
  'radar_clusters',
  'radar_cluster_label',
] as const;

export type OutputType = (typeof OUTPUT_TYPES)[number];

interface RecordOutputParams {
  output_type: OutputType;
  content: Record<string, unknown>;
  generation_context?: Record<string, unknown>;
  user_id?: string | null;
  source_table?: string | null;
  source_id?: string | null;
}

/**
 * Record a generated output. Returns output id (UUID) on success, null on failure.
 *
 * Failures are logged but never thrown - recording must not block generation.
 * That contract is deliberate and is kept: several callers record on a path
 * where a throw would break the user-facing response.
 *
 * The cost of that contract is that `null` is the ONLY failure signal a caller
 * gets. Callers that depend on the write landing (a cache, for example) must
 * check the return value; ignoring it is how a permanently failing write stays
 * invisible. The log line now carries the SQLSTATE code so 22P02-class schema
 * mismatches are identifiable from a log body instead of just "failed".
 */
export async function recordOutput(
  supabase: SupabaseClient,
  params: RecordOutputParams
): Promise<string | null> {
  try {
    const payload: Record<string, unknown> = {
      output_type: params.output_type,
      content: params.content,
      generation_context: params.generation_context ?? {},
    };
    if (params.user_id) payload.user_id = params.user_id;
    if (params.source_table) payload.source_table = params.source_table;
    if (params.source_id) payload.source_id = params.source_id;

    const { data, error } = await supabase
      .from('outputs')
      .insert(payload)
      .select('id')
      .single();

    if (error) {
      console.error(
        `[outputs] Failed to record ${params.output_type}:`,
        JSON.stringify({ code: error.code, message: error.message, details: error.details })
      );
      return null;
    }
    return data?.id ?? null;
  } catch (e) {
    console.error(`[outputs] Exception recording ${params.output_type}:`, e);
    return null;
  }
}
