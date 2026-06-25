import { NextRequest, NextResponse } from "next/server";

import { resolveOrCreateCompany } from "@/lib/data-access/resolveOrCreateCompany";
import { getSupabaseWithUser } from "@/lib/supabase-server";

// On-demand company resolve+create. Auth-gated (mirrors the company page gate)
// so an unauthenticated caller cannot fan out Finnhub calls or writes. The
// write itself is service-role inside resolveOrCreateCompany; this route never
// touches the anon client for the insert.
export const runtime = "nodejs";

const MAX_QUERY_LEN = 80;

export async function POST(request: NextRequest) {
  const { user } = await getSupabaseWithUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { query?: unknown };
  try {
    body = (await request.json()) as { query?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query || query.length > MAX_QUERY_LEN) {
    return NextResponse.json({ error: "invalid query" }, { status: 400 });
  }

  try {
    const outcome = await resolveOrCreateCompany(query);
    const status = outcome.status === "not_found" ? 404 : 200;
    return NextResponse.json(outcome, { status });
  } catch (e) {
    console.error("[company/resolve] failed:", e);
    return NextResponse.json({ error: "resolve failed" }, { status: 500 });
  }
}
