import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { recordOutput, isOutputType, OUTPUT_TYPES } from "@/lib/outputs";

/**
 * Lightweight endpoint to record an output row without regenerating content.
 * Used when displaying preloaded/cached content that still needs an output_id
 * for feedback tracking (e.g. cached watchlist briefs).
 *
 * THE BODY IS UNTRUSTED. `output_type` used to be typed `OutputType` on the
 * parsed body and checked for truthiness only. That is an assertion, not a
 * check: TypeScript erases the union at compile time, so any authenticated
 * caller could POST any string and it went straight into an enum column.
 * Postgres 22P02s it, supabase-js reports that without raising, recordOutput
 * logs it, and the caller sees a generic 500 that names nothing. Validated
 * against OUTPUT_TYPES here so a bad value is a 400 that says what was wrong.
 */
export async function POST(req: NextRequest) {
  const { user } = await getSupabaseWithUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: {
    output_type?: unknown;
    content?: Record<string, unknown>;
    generation_context?: Record<string, unknown>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (!body.output_type || !body.content) {
    return NextResponse.json({ error: "output_type and content required" }, { status: 400 });
  }

  if (!isOutputType(body.output_type)) {
    return NextResponse.json(
      { error: "unknown output_type", allowed: OUTPUT_TYPES },
      { status: 400 }
    );
  }

  const svcSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  const outputId = await recordOutput(svcSupabase, {
    output_type: body.output_type,
    content: body.content,
    generation_context: body.generation_context ?? {},
    user_id: user.id,
  });

  if (!outputId) {
    return NextResponse.json({ error: "failed to record output" }, { status: 500 });
  }

  return NextResponse.json({ output_id: outputId });
}
