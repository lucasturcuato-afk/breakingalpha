import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: NextRequest) {
  const token = request.headers
    .get("authorization")
    ?.replace("Bearer ", "");
  if (!token)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { entries } = body as { entries?: unknown[] };
  if (!Array.isArray(entries) || entries.length === 0)
    return NextResponse.json(
      { error: "entries array required" },
      { status: 400 }
    );

  for (const entry of entries) {
    const e = entry as Record<string, unknown>;
    if (!e.identifier || !e.type)
      return NextResponse.json(
        { error: "Each entry requires identifier and type" },
        { status: 400 }
      );
  }

  const { data, error } = await supabase
    .from("watchlist")
    .insert(entries)
    .select();
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entries: data });
}
