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
 * THREE LISTS, ONE FACT. This is not the only statement of it:
 *
 *   A. this constant                     written by a developer editing TS
 *   B. `OutputType` in backend/outputs.py written by a developer editing Python
 *   C. `public.output_type_enum`          written by Postgres, and the only one
 *                                         that decides anything at runtime
 *
 * A and B had drifted to 15 and 14 members against an enum of 16. Both are now
 * pinned to tests/fixtures/output-type-enum.json, which is captured FROM the
 * database by scripts/capture-output-type-enum.mjs and is not hand-authored:
 * src/lib/outputs.enum.test.ts guards A, backend/tests/test_output_type_enum.py
 * guards B. They are held EQUAL to the enum rather than merely contained by it,
 * so there is one true statement of what the column accepts in each language
 * instead of three partial ones.
 *
 * Adding an entry here REQUIRES a migration that adds the same value to
 * output_type_enum, declared under "pending" in that fixture.
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
  'sec_filing',
  'insider_transaction',
  'radar_clusters',
  'radar_cluster_label',
  'company_overview',
] as const;

export type OutputType = (typeof OUTPUT_TYPES)[number];

/**
 * Runtime membership check for a value that did not come from TypeScript.
 *
 * `OutputType` is erased at compile time, so any route that types a request
 * body as `{ output_type: OutputType }` is asserting, not checking. A caller
 * can POST any string at all and it goes straight to Postgres, which 22P02s it
 * into a log. Anything reading an output_type off the wire must run it through
 * here first.
 */
export function isOutputType(value: unknown): value is OutputType {
  return typeof value === "string" && (OUTPUT_TYPES as readonly string[]).includes(value);
}

/**
 * `outputs.source_id` is a `uuid` column, not text.
 *
 * Handing it anything else raises 22P02 ("invalid input syntax for type uuid")
 * and takes the WHOLE insert down with it, which is how the Coverage Primer
 * cache lost every row twice over: once on the enum and once, independently, on
 * a company NAME passed as source_id. The parameter is typed `string`, so
 * TypeScript is no help. Checked at the boundary instead.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

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
    // Reject the two 22P02 shapes at the boundary rather than at the database.
    // The outcome is `null` either way, so this changes no caller's behaviour;
    // what it changes is that the log names the real cause instead of an opaque
    // SQLSTATE arriving from a round trip nobody watches.
    if (!isOutputType(params.output_type)) {
      console.error(
        "[outputs] Refusing to record an output_type the enum will reject:",
        JSON.stringify({ output_type: params.output_type, allowed: OUTPUT_TYPES })
      );
      return null;
    }
    if (params.source_id != null && !isUuid(params.source_id)) {
      console.error(
        `[outputs] Refusing to record ${params.output_type}: source_id is a uuid column and this is not a uuid:`,
        JSON.stringify({ source_id: params.source_id })
      );
      return null;
    }

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
