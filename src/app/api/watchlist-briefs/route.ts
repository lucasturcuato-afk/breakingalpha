import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// Server-side writer for the per-ticker watchlist brief cache. This used to be
// a browser-side upsert with the anon key. It is moved here so the write runs
// as service-role, which is a prerequisite for locking watchlist_briefs writes
// to service-role-only in the RLS lockdown (Phase 2). Hard service-role: if the
// key is missing we fail loud rather than fall back to anon.
export async function POST(req: NextRequest) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json(
      { error: "service role key not configured" },
      { status: 500 },
    );
  }

  let body: {
    identifier?: string;
    brief_text?: string;
    article_count?: number;
    model?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { identifier, brief_text, article_count, model } = body;
  if (!identifier || !brief_text) {
    return NextResponse.json(
      { error: "identifier and brief_text required" },
      { status: 400 },
    );
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey,
  );

  const { error } = await supabase.from("watchlist_briefs").upsert(
    {
      identifier,
      brief_text,
      article_count: article_count ?? 0,
      generated_at: new Date().toISOString(),
      model: model ?? "gemini-2.5-flash",
    },
    { onConflict: "identifier" },
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
