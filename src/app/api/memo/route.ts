import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

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
};

export async function POST(request: NextRequest) {
  const body = await request.json();
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
    const system = systemPrompt || TYPE_PROMPTS[type] || TYPE_PROMPTS.article;
    const truncated = (content || "").slice(0, 1500);

    try {
      const completion = await groq.chat.completions.create({
        model: "llama-3.1-8b-instant",
        messages: [
          { role: "system", content: system },
          { role: "user", content: truncated },
        ],
        max_tokens: 750,
        temperature: 0.35,
      });

      const memo = completion.choices[0]?.message?.content || "";
      return NextResponse.json({ memo });
    } catch (err) {
      console.error("Groq memo error:", err);
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
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 600,
      temperature: 0.35,
    });

    const memo = completion.choices[0]?.message?.content || "";
    return NextResponse.json({ memo });
  } catch (err) {
    console.error("Groq memo error:", err);
    return NextResponse.json(
      { error: "Failed to generate memo" },
      { status: 500 }
    );
  }
}
