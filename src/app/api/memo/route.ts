import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import { getSupabaseWithUser } from "@/lib/supabase-server";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const TYPE_PROMPTS: Record<string, string> = {
  deal: "You are an M&A analyst. Write a concise deal memo: Deal Overview, Strategic Rationale, Key Risks, Valuation Considerations, Recommendation. Use bullet points. Under 300 words.",
  thesis: "You are a buy-side equity research analyst. Write an investment thesis memo: Core Thesis, Supporting Evidence, Bear Case, Catalysts to Watch, Position Sizing. Be analytical. Under 300 words.",
  brief: "You are a market strategist. Write a market brief: Key Macro Takeaway, Sector Implications, Trade Ideas, Risk Flags. Under 300 words.",
  article: "You are a financial analyst. Summarize market implications: What Happened, Market Impact, Actionable Insight. Under 250 words.",
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
    const truncated = String(content || "").slice(0, 1500);

    try {
      const completion = await groq.chat.completions.create({
        model: "llama-3.1-8b-instant",
        messages: [
          { role: "system", content: system },
          { role: "user", content: truncated },
        ],
        max_tokens: 600,
        temperature: 0.35,
      });

      const memo = completion.choices[0]?.message?.content;
      if (!memo) {
        return NextResponse.json({ error: "Groq returned empty memo — retry" }, { status: 500 });
      }
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

    const memo = completion.choices[0]?.message?.content;
    if (!memo) {
      return NextResponse.json({ error: "Groq returned empty memo — retry" }, { status: 500 });
    }
    return NextResponse.json({ memo });
  } catch (err) {
    console.error("Groq memo error:", err);
    return NextResponse.json(
      { error: "Failed to generate memo" },
      { status: 500 }
    );
  }
}
