import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { recordOutput } from "@/lib/outputs";
import type { OutputType } from "@/lib/outputs";

/**
 * Lightweight endpoint to record an output row without regenerating content.
 * Used when displaying preloaded/cached content that still needs an output_id
 * for feedback tracking (e.g. cached watchlist briefs).
 */
export async function POST(req: NextRequest) {
  const { user } = await getSupabaseWithUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: {
    output_type: OutputType;
    content: Record<string, unknown>;
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
