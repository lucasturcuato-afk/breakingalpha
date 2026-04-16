import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import type { RiskAppetite, UserRole } from "@/lib/user-profile";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

interface PreviewBody {
  role: UserRole | null;
  sectors: string[];
  risk_appetite: RiskAppetite;
  watchlist_tickers: string[];
}

interface PreviewResult {
  title: string;
  sector: string;
  conviction: "HIGH" | "MEDIUM" | "WATCH" | "BEARISH";
  rationale: string;
}

const FALLBACK = (body: PreviewBody): PreviewResult => ({
  title:
    body.sectors[0] && body.watchlist_tickers[0]
      ? `${body.watchlist_tickers[0]} — ${body.sectors[0]} setup worth watching`
      : body.sectors[0]
        ? `${body.sectors[0]} — early signal building`
        : "An idea tailored to your profile",
  sector: body.sectors[0] ?? "Cross-Sector",
  conviction: body.risk_appetite === "aggressive" ? "HIGH" : "MEDIUM",
  rationale:
    "This is a placeholder preview — once you finish onboarding, Signalera will pull live signals for your sectors, tickers and risk profile from today's ingested articles.",
});

export async function POST(request: NextRequest) {
  let body: PreviewBody = {
    role: null,
    sectors: [],
    risk_appetite: "balanced",
    watchlist_tickers: [],
  };
  try {
    const { user } = await getSupabaseWithUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    body = (await request.json()) as PreviewBody;

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(FALLBACK(body));
    }

    const prompt = [
      "You are Signalera, an equity research assistant.",
      "Generate ONE preview investment thesis for a user who just finished onboarding.",
      "Do NOT use real breaking news — generate a realistic-sounding plausible setup.",
      "",
      "USER PROFILE:",
      `- Role: ${body.role ?? "investor"}`,
      `- Focus sectors: ${(body.sectors ?? []).join(", ") || "none specified"}`,
      `- Risk appetite: ${body.risk_appetite}`,
      `- Watchlist: ${(body.watchlist_tickers ?? []).join(", ") || "none"}`,
      "",
      "Return STRICT JSON only — no markdown, no prose — matching:",
      "{",
      '  "title": "<8-14 word thesis title>",',
      '  "sector": "<one sector from the user\'s focus list>",',
      '  "conviction": "HIGH" | "MEDIUM" | "WATCH" | "BEARISH",',
      '  "rationale": "<2-3 sentences tying the thesis back to the user\'s profile>"',
      "}",
    ].join("\n");

    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        temperature: 0.7,
      },
    });

    const text = result.text?.trim() ?? "";
    let parsed: PreviewResult;
    try {
      parsed = JSON.parse(text) as PreviewResult;
    } catch {
      return NextResponse.json(FALLBACK(body));
    }

    // Defensive cleanup — make sure conviction is valid and fields are strings.
    const valid: PreviewResult["conviction"][] = [
      "HIGH",
      "MEDIUM",
      "WATCH",
      "BEARISH",
    ];
    if (!valid.includes(parsed.conviction)) parsed.conviction = "MEDIUM";
    if (typeof parsed.title !== "string" || !parsed.title.trim()) {
      parsed.title = FALLBACK(body).title;
    }
    if (typeof parsed.sector !== "string" || !parsed.sector.trim()) {
      parsed.sector = body.sectors[0] ?? "Cross-Sector";
    }
    if (typeof parsed.rationale !== "string" || !parsed.rationale.trim()) {
      parsed.rationale = FALLBACK(body).rationale;
    }

    return NextResponse.json(parsed);
  } catch (err) {
    console.error("[preview-thesis] error:", err);
    // Graceful fallback on any error so onboarding never blocks.
    return NextResponse.json(FALLBACK(body));
  }
}
