/**
 * POST /api/companies/thin-fallback
 *
 * Tiered PRIMARY-SOURCE fallback for the Company Intel web-memo path. Fired by
 * the client only when the web-fallback thin-pool gate trips (too few on-entity
 * news sources for a reliable brief). Instead of narrating a thesis on a starved
 * pool, this returns the richest available structured data (financials + SEC
 * filings) and degrades by data presence to an honest no-coverage state.
 *
 * Read-only: resolves the company CIK and reads financial_facts_latest +
 * sec_filings via the service client (public reference tables). Writes nothing,
 * generates no memo, touches no memo pool.
 *
 * Auth: signed-in users only (mirrors /api/companies/web-fallback). 401 when
 * unauthenticated, 503 when the NEXT_PUBLIC_THIN_FALLBACK_ENABLED flag is not
 * "true". Flag default is off.
 */
import { NextRequest, NextResponse } from "next/server";

import { getSupabaseWithUser } from "@/lib/supabase-server";
import { getServiceSupabase } from "@/lib/supabase-service";
import { buildThinFallback } from "@/lib/thin-fallback";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (process.env.NEXT_PUBLIC_THIN_FALLBACK_ENABLED !== "true") {
    return NextResponse.json({ error: "Thin fallback is not enabled" }, { status: 503 });
  }

  const { user } = await getSupabaseWithUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { query?: string; name?: string; ticker?: string; companyId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = (body.name ?? body.query ?? "").trim();
  const companyId = typeof body.companyId === "string" ? body.companyId.trim() : null;
  if (name.length < 2 && !companyId) {
    return NextResponse.json(
      { error: "A company name or id is required" },
      { status: 400 },
    );
  }
  if (name.length > 200) {
    return NextResponse.json({ error: "Name too long" }, { status: 400 });
  }

  try {
    // Service client: financial_facts_latest / sec_filings are public reference
    // tables; the service read bypasses RLS the same way the Financials/Filings
    // tabs resolve their data server-side.
    const supabase = getServiceSupabase();
    const data = await buildThinFallback(supabase, {
      id: companyId,
      name: name || null,
    });
    return NextResponse.json(data);
  } catch (err) {
    console.error("[api/companies/thin-fallback] failed:", err);
    return NextResponse.json({ error: "Thin fallback failed" }, { status: 502 });
  }
}
