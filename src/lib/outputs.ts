/**
 * Universal output recorder. Writes to the `outputs` table for every
 * AI-generated output. Foundation for feedback collection and outcome grading.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type OutputType =
  | 'memo'
  | 'brief'
  | 'brief_section'
  | 'brief_cluster'
  | 'chat_answer'
  | 'thesis'
  | 'thesis_grade'
  | 'contrarian_signal'
  | 'deal_extraction'
  | 'user_addendum'
  | 'mention_alert'
  | 'cross_reference'
  | 'company_overview';

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
 * Failures are logged but never thrown — recording must not block generation.
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
      console.error(`[outputs] Failed to record ${params.output_type}:`, error.message);
      return null;
    }
    return data?.id ?? null;
  } catch (e) {
    console.error(`[outputs] Exception recording ${params.output_type}:`, e);
    return null;
  }
}
