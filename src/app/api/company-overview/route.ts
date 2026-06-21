// Coverage Primer business-overview normalizer + write-through cache.
//
// POST { company, ticker?, sector?, industry?, summary?, segments? } ->
//   { overview: string, cached: boolean }
//
// Reuses the existing `outputs` table (output_type='company_overview'), mirroring
// the memo cache: read the latest row for content->>target_company; if its
// source_hash still matches the current inputs, serve it with NO write; else
// generate a strictly-grounded normalized overview via Gemini, sanitize, and
// write a single per-company row (recordOutput). Never a bulk write; never
// blocks on failure (returns the raw summary fallback). No new table or column.

import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";

import { getSupabaseWithUser } from "@/lib/supabase-server";
import { recordOutput } from "@/lib/outputs";
import {
  buildOverviewPrompt,
  overviewSourceHash,
  sanitizeOverview,
  type OverviewInputs,
} from "@/lib/company-overview";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Service-role client for the cross-user overview cache (outputs RLS is
// user-scoped; the normalized overview is company-scoped, not user data).
// autoRefreshToken:false avoids a retained refresh ticker on reused instances.
function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export async function POST(request: NextRequest) {
  // Auth gate (mirrors the other company routes); the page is already gated.
  const { user } = await getSupabaseWithUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Partial<OverviewInputs> & { company?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const name = (body.company || body.name || "").trim();
  if (!name) return NextResponse.json({ error: "company required" }, { status: 400 });

  const inputs: OverviewInputs = {
    name,
    ticker: body.ticker ?? null,
    sector: body.sector ?? null,
    industry: body.industry ?? null,
    summary: body.summary ?? null,
    segments: body.segments ?? null,
  };
  const hash = overviewSourceHash(inputs);

  // Fallback served on any generation/cache failure: the raw summary, so the
  // Primer is never worse off than before this feature.
  const rawFallback = (inputs.summary ?? "").trim();

  const svc = serviceClient();

  // 1. Read latest cached overview for this company.
  try {
    const { data } = await svc
      .from("outputs")
      .select("content")
      .eq("output_type", "company_overview")
      .eq("content->>target_company", name)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const cached = data?.content as { overview?: string; source_hash?: string } | undefined;
    if (cached?.overview && cached.source_hash === hash) {
      return NextResponse.json({ overview: cached.overview, cached: true });
    }
  } catch (e) {
    console.warn("[company-overview] cache read failed (non-fatal):", e);
  }

  // 2. Generate a strictly-grounded normalized overview.
  const { system, user: userPrompt } = buildOverviewPrompt(inputs);
  let overview = "";
  try {
    const completion = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      config: {
        systemInstruction: system,
        temperature: 0.2,
        maxOutputTokens: 256,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    overview = sanitizeOverview(completion.text);
  } catch (e) {
    console.warn("[company-overview] generation failed (non-fatal):", e);
    // Serve the raw summary fallback; do not cache a fallback.
    return NextResponse.json({ overview: rawFallback, cached: false });
  }

  if (!overview) {
    // Thin or unusable source: nothing to cache. Caller falls back to raw/curated.
    return NextResponse.json({ overview: rawFallback, cached: false });
  }

  // 3. Write-through: a single per-company row. recordOutput never throws.
  try {
    await recordOutput(svc, {
      output_type: "company_overview",
      content: { target_company: name, overview, source_hash: hash },
      source_table: "companies",
      source_id: name,
    });
  } catch (e) {
    console.warn("[company-overview] cache write failed (non-fatal):", e);
  }

  return NextResponse.json({ overview, cached: false });
}
