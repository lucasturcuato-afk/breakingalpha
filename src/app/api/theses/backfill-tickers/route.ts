import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { thesisDedupKey, thesisFuzzyKey } from "@/lib/thesis-mapper";
import { getServiceSupabase } from "@/lib/supabase-service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const SECTOR_ETF_MAP: Record<string, string> = {
  technology: "XLK", tech: "XLK", software: "XLK",
  financials: "XLF", finance: "XLF", banking: "XLF",
  healthcare: "XLV", health: "XLV", biotech: "XLV", pharma: "XLV",
  energy: "XLE", oil: "XLE", "oil & gas": "XLE",
  industrials: "XLI", industrial: "XLI", defense: "XLI", aerospace: "XLI",
  "consumer discretionary": "XLY", retail: "XLY", "consumer cyclical": "XLY",
  "consumer staples": "XLP",
  communications: "XLC", media: "XLC", telecom: "XLC",
  utilities: "XLU",
  materials: "XLB",
  "real estate": "XLRE",
  general: "SPY", macro: "SPY", market: "SPY",
};

/**
 * POST /api/theses/backfill-tickers
 * One-time: backfill null tickers via Gemini, then clean up duplicates.
 */
export async function POST(request: NextRequest) {
  // Internal-key only. This route runs a global, destructive dedup-delete
  // across ALL users' theses with a service-role client, so it MUST NOT be
  // reachable by a normal logged-in user session. Same shared-secret pattern
  // as /api/grading/trigger and /api/grading/grade-brief.
  const internalKey = process.env.INTERNAL_API_KEY;
  if (!internalKey) {
    // Do NOT leak whether the header matched.
    return NextResponse.json(
      { error: "INTERNAL_API_KEY not configured" },
      { status: 500 },
    );
  }

  const providedKey = request.headers.get("x-internal-key");
  if (providedKey !== internalKey) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const adminSupabase = getServiceSupabase();

  // 1. Fetch all theses with null ticker
  const { data: nullTickerRows, error: fetchErr } = await adminSupabase
    .from("theses")
    .select("id, title, sector, rationale")
    .is("ticker", null);

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  let backfilledCount = 0;
  if (nullTickerRows && nullTickerRows.length > 0) {
    // Batch: ask Gemini for tickers for all null-ticker theses in one call
    const items = nullTickerRows.map((r, i) => `${i + 1}. "${r.title}" (sector: ${r.sector})`).join("\n");
    const prompt = `For each thesis below, return the single best US stock ticker to track it. For company-specific theses, use the company ticker. For macro/sector theses, use a sector ETF (XLK, XLF, XLV, XLE, XLI, XLC, XLY, XLP, XLU, XLB, XLRE, SPY, GLD, TLT). Return a JSON array of objects: [{index: number, ticker: string}]. Every thesis MUST have a ticker — never null.

${items}`;

    try {
      const completion = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          temperature: 0.1,
          maxOutputTokens: 1000,
          responseMimeType: "application/json",
          thinkingConfig: { thinkingBudget: 0 },
        },
      });

      const raw = completion.text || "";
      const cleaned = raw.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(cleaned) as Array<{ index: number; ticker: string }>;

      for (const item of parsed) {
        const row = nullTickerRows[item.index - 1];
        if (!row) continue;
        let ticker = typeof item.ticker === "string" && item.ticker.trim().length > 0
          ? item.ticker.trim().toUpperCase()
          : null;
        // Fallback to sector ETF map
        if (!ticker) {
          const sectorLower = (row.sector || "").trim().toLowerCase();
          ticker = SECTOR_ETF_MAP[sectorLower] || "SPY";
        }
        const { error: updateErr } = await adminSupabase
          .from("theses")
          .update({ ticker })
          .eq("id", row.id);
        if (!updateErr) backfilledCount++;
      }
    } catch (e) {
      console.error("[backfill-tickers] Gemini backfill failed:", e);
      // Fallback: use sector ETF map for all
      for (const row of nullTickerRows) {
        const sectorLower = (row.sector || "").trim().toLowerCase();
        const ticker = SECTOR_ETF_MAP[sectorLower] || "SPY";
        const { error: updateErr } = await adminSupabase
          .from("theses")
          .update({ ticker })
          .eq("id", row.id);
        if (!updateErr) backfilledCount++;
      }
    }
  }

  // 2. Clean up duplicates: keep newest by generated_at per (title|sector) group
  const { data: allTheses, error: allErr } = await adminSupabase
    .from("theses")
    .select("id, title, sector, generated_at")
    .order("generated_at", { ascending: false });

  let deletedCount = 0;
  if (!allErr && allTheses) {
    const exactSeen = new Map<string, string>(); // key -> kept id
    const fuzzySeen = new Map<string, string>();
    const toDelete: string[] = [];

    for (const row of allTheses) {
      const exactKey = thesisDedupKey(row);
      const fuzzyKey = thesisFuzzyKey(row);

      if (exactSeen.has(exactKey) || fuzzySeen.has(fuzzyKey)) {
        toDelete.push(row.id);
      } else {
        exactSeen.set(exactKey, row.id);
        fuzzySeen.set(fuzzyKey, row.id);
      }
    }

    if (toDelete.length > 0) {
      // Delete in batches of 50
      for (let i = 0; i < toDelete.length; i += 50) {
        const batch = toDelete.slice(i, i + 50);
        const { error: delErr } = await adminSupabase
          .from("theses")
          .delete()
          .in("id", batch);
        if (!delErr) deletedCount += batch.length;
      }
    }
  }

  return NextResponse.json({
    backfilled: backfilledCount,
    nullTickerCount: nullTickerRows?.length ?? 0,
    duplicatesDeleted: deletedCount,
  });
}
