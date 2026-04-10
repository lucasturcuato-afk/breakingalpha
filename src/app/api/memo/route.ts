import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { getSupabaseWithUser } from "@/lib/supabase-server";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const TYPE_PROMPTS: Record<string, string> = {
  deal: `You are a senior M&A analyst. Write a sharp deal memo with exactly these 4 sections in this order:

**Deal Snapshot**
Bullet list of facts from the input only: Target, Acquirer, Type, Value, Status, Sector. Use "Undisclosed" for missing facts. No commentary here.

**Why It Makes Sense**
Infer the likely strategic logic from the deal type, sector, size, and any NOTES/CONTEXT in the input. Use grounded cautious language — "appears aimed at…", "likely reflects…", "suggests a push into…". This section must always be substantive and specific to THIS deal. Banned phrases: "wave of consolidation", "consolidation trend", "broader consolidation", "part of a trend", "fits a broader pattern", "reflects broader", "amid a wave", "signals a trend". If you cannot be specific, describe what the acquirer likely gains from this specific target.

**Why It Matters**
State the investor, operator, or market implication in 2–3 concrete sentences tied to the specific companies and sector. Do not write generic macro commentary. Do not repeat Snapshot facts unless they directly drive the implication.

**What To Watch**
List 2–3 grounded watchpoints specific to THIS deal: regulatory approvals for this sector, financing risk based on the disclosed value, integration complexity between these two entities, or execution timeline for this transaction type. Never write generic watchpoints that could apply to any M&A deal.

Hard rules: no invented counterparties, dollar figures, or valuation assumptions beyond what is provided. No recommendation section. No standalone valuation section. No empty sections. Every sentence must reference something specific from the input. Under 320 words.`,
  thesis: "You are a buy-side equity research analyst. Write an investment thesis memo using ONLY the facts provided. Do NOT invent price targets, ratings, or figures not present in the input. Sections: Core Thesis, Supporting Evidence, Bear Case, Catalysts to Watch. Under 300 words.",
  brief: "You are a market strategist. Write a market brief: Key Macro Takeaway, Sector Implications, Risk Flags. Under 300 words.",
  article: "You are a financial analyst. Summarize market implications using only what is stated: What Happened, Market Impact, Actionable Insight. Under 250 words.",
  company: "You are a sector analyst. Write a company intelligence brief. Use only facts from the provided articles. Sections: Company Brief (sector and primary business), Recent Developments (Direct articles only), Sector Context (Context articles as backdrop), Key Watchpoints (2–3 from Direct articles only), Signal Quality (one controlled label + one sentence). Under 300 words.",
};

export async function POST(request: NextRequest) {
  const { user } = await getSupabaseWithUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: {
    company?: string;
    acquirer?: string;
    deal_type?: string;
    value?: string;
    sector?: string;
    description?: string;
    type?: string;
    systemPrompt?: string;
    content?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    company,
    acquirer,
    deal_type,
    value,
    sector,
    description,
    type,
    systemPrompt,
    content,
  } = body;

  // New path: type-based memo with content string
  if (content || systemPrompt) {
    const system = systemPrompt || (type ? TYPE_PROMPTS[type] : undefined) || TYPE_PROMPTS.article;
    const truncated = String(content || "").slice(0, 4000);

    try {
      const completion = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: truncated }] }],
        config: {
          systemInstruction: system,
          temperature: 0.35,
          maxOutputTokens: 750,
          thinkingConfig: { thinkingBudget: 0 },
        },
      });

      const memo = completion.text;
      if (!memo) {
        return NextResponse.json({ error: "Gemini returned empty memo — retry" }, { status: 500 });
      }
      return NextResponse.json({ memo });
    } catch (err) {
      console.error("Gemini memo error:", err);
      return NextResponse.json(
        { error: "Failed to generate memo" },
        { status: 500 }
      );
    }
  }

  // Legacy path: deal-flow deal memo (company required)
  if (!company)
    return NextResponse.json(
      { error: "company or content is required" },
      { status: 400 }
    );

  const prompt = `You are a senior IB analyst. Write a concise deal memo for this transaction. Be specific, use bullet points.

TARGET: ${company}
ACQUIRER: ${acquirer || "Undisclosed"}
TYPE: ${deal_type || "M&A"}
VALUE: ${value || "Undisclosed"}
SECTOR: ${sector || "Technology"}
CONTEXT: ${(description || "").slice(0, 400)}

Sections: TRANSACTION OVERVIEW, STRATEGIC RATIONALE, KEY RISKS, ANALYST TAKE. Under 300 words.`;

  try {
    const completion = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        temperature: 0.35,
        maxOutputTokens: 600,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const memo = completion.text;
    if (!memo) {
      return NextResponse.json({ error: "Gemini returned empty memo — retry" }, { status: 500 });
    }
    return NextResponse.json({ memo });
  } catch (err) {
    console.error("Gemini memo error:", err);
    return NextResponse.json(
      { error: "Failed to generate memo" },
      { status: 500 }
    );
  }
}
