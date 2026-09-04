// Coverage Primer business-overview normalizer + write-through cache.
//
// POST { company, ticker?, sector?, industry?, summary?, segments? } ->
//   { overview: string, cached: boolean,
//     cache_write_ok?: boolean, cache_read_failed?: true }
//
// Reuses the existing `outputs` table, keyed on (output_type, target_company,
// source_hash). Read the row matching those three; if it carries a usable
// overview, serve it with NO write and NO model call; else generate a
// strictly-grounded normalized overview via Gemini, sanitize, and write one row.
// Never a bulk write; never blocks on failure (returns the raw summary
// fallback). No new table or column.
//
// THREE THINGS WERE WRONG AND ANY ONE OF THEM ALONE KEPT THE CACHE AT 0%.
//
//   1. output_type 'company_overview' was not a member of output_type_enum, so
//      Postgres 22P02'd BOTH the read filter and the write.
//   2. `source_id` (a uuid column) was being handed a company NAME, which
//      22P02'd the write a second, independent time.
//   3. The read narrowed on company only and validated source_hash AFTER the
//      row came back, so recency picked the winner. PrimerTab POSTs two
//      different bodies per mount for any company with both a curated
//      description and a live quote, which is two hashes under one cache key,
//      so each read kept returning the other variant's row and missing.
//
// supabase-js returns 1 and 2 in the result object rather than throwing, the
// read discarded `error` entirely, and the write logged to a console nobody
// reads. 3 needs no error at all: it is a correct query answering the wrong
// question. Net effect: 100% cache miss and a gemini-2.5-flash call on every
// Primer view. See
// supabase/migrations/20260903143000_add_company_overview_output_type.sql.
//
// NOTE ON WHAT IS SAVED: the client POSTs once per effect run either way, and
// the fix does not change how many times it POSTs. What the cache eliminates is
// the MODEL CALL inside this route.

import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";

import { getSupabaseWithUser } from "@/lib/supabase-server";
import { recordOutput } from "@/lib/outputs";
import {
  buildOverviewPrompt,
  buildOverviewCacheRow,
  isOverviewCacheHit,
  overviewCacheFilter,
  overviewSourceHash,
  sanitizeOverview,
  type OverviewCacheContent,
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

  // 1. Read the cached overview matching these exact inputs.
  //
  // SELECT BY HASH, DO NOT VALIDATE AFTER. Every equality in
  // overviewCacheFilter is applied here, including content->>source_hash, so
  // the query can only return a row that is servable. The earlier version
  // narrowed on company alone and let `.order(created_at desc).limit(1)` pick
  // the winner, then checked the hash on the way out. That is latest-row-wins,
  // and it misses every time for the 34 curated companies, because PrimerTab
  // POSTs two different bodies per mount (curated first, live Yahoo summary
  // once the quote resolves and the effect deps change). Two hashes under one
  // cache key: each read returned the OTHER variant's row. See the comment on
  // overviewCacheFilter for the full mechanism.
  //
  // `.order().limit(1)` stays. The filter narrows to one logical entry, but two
  // concurrent misses can both write, and maybeSingle() errors on more than one
  // row. Recency now only breaks ties between rows that are already equivalent.
  //
  // supabase-js does NOT throw on a PostgREST error, it returns it in `error`.
  // This block previously destructured only `data`, discarding `error`, so a
  // filter that the database rejected outright (22P02 on the output_type enum)
  // produced a silent null and an unconditional fall-through to Gemini. The
  // surrounding try/catch never fired because nothing was ever thrown. Read
  // `error` explicitly; the catch stays only for genuine transport throws.
  let cacheReadFailed = false;
  try {
    let query = svc.from("outputs").select("content");
    for (const [column, value] of Object.entries(overviewCacheFilter(name, hash))) {
      query = query.eq(column, value);
    }
    const { data, error } = await query
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      cacheReadFailed = true;
      console.error(
        "[company-overview] cache read failed (non-fatal):",
        JSON.stringify({ code: error.code, message: error.message, details: error.details })
      );
    }
    const cached = data?.content as Partial<OverviewCacheContent> | undefined;
    if (isOverviewCacheHit(cached, hash)) {
      return NextResponse.json({ overview: cached!.overview, cached: true });
    }
  } catch (e) {
    cacheReadFailed = true;
    console.error("[company-overview] cache read threw (non-fatal):", e);
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

  // 3. Write-through: a single per-company row.
  //
  // recordOutput keeps its never-throw contract on purpose: a cache write that
  // threw would turn a cost problem into an availability problem and break the
  // Primer for users whenever `outputs` is unhappy. The tradeoff is that `null`
  // is the ONLY failure signal, and ignoring it is precisely how this route
  // burned a Gemini call on every single page view undetected. So the return
  // value is now checked and the outcome is reported in the response body:
  // machine-visible to the browser, to e2e, and to anything replaying the API,
  // without any user-facing regression.
  //
  // What this deliberately does NOT do is alert. console.error in a Vercel
  // function is not surfacing, and this repo has no metrics sink to write a
  // counter to. `cache_write_ok` in the response is the honest ceiling here; a
  // real alert needs an observability target that does not exist yet.
  let cacheWriteOk = false;
  try {
    const row = buildOverviewCacheRow(name, overview, hash);
    cacheWriteOk = (await recordOutput(svc, row)) !== null;
  } catch (e) {
    console.error("[company-overview] cache write threw (non-fatal):", e);
  }
  if (!cacheWriteOk) {
    console.error(
      "[company-overview] cache write did not land; this company will re-bill Gemini on the next view:",
      name
    );
  }

  return NextResponse.json({
    overview,
    cached: false,
    cache_write_ok: cacheWriteOk,
    ...(cacheReadFailed ? { cache_read_failed: true } : {}),
  });
}
