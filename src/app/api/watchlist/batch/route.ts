import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

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

  // Resolve authenticated user from token (matches single-add path)
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  // Normalize identifiers to match single-add path (trim + uppercase)
  interface RawEntry { identifier: string; type: string }
  const normalized = (entries as RawEntry[])
    .map((e) => ({
      identifier: (e.identifier || "").trim().toUpperCase(),
      type: e.type,
      user_id: user.id,
    }))
    .filter((e) => e.identifier && e.type);

  if (!normalized.length)
    return NextResponse.json({ entries: [] });

  // Fetch existing entries to dedup (same guard as single-add path)
  const { data: existing } = await supabase
    .from("watchlist")
    .select("identifier, type")
    .eq("user_id", user.id);

  // Normalize existing keys to uppercase so legacy mixed-case DB rows are caught
  const existingSet = new Set(
    (existing || []).map((e: { identifier: string; type: string }) =>
      `${e.identifier.toUpperCase()}::${e.type}`
    )
  );

  const toInsert = normalized.filter(
    (e) => !existingSet.has(`${e.identifier}::${e.type}`)
  );

  if (!toInsert.length)
    return NextResponse.json({ entries: [] });

  const { data, error } = await supabase
    .from("watchlist")
    .insert(toInsert)
    .select();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entries: data });
}
