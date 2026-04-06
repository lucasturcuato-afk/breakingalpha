import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const TYPE_PROMPTS: Record<string, string> = {
  deal: "You are an M&A analyst. Write a concise deal memo using ONLY the facts provided in the input. Do NOT invent or infer any figures, parties, valuations, or recommendations that are not explicitly stated. If a field says 'Undisclosed' or is absent, state 'Undisclosed' — never fabricate a number or name. Sections: Deal Overview, Strategic Rationale, Key Risks. Include a Valuation section ONLY if an actual value is present in the input; omit it otherwise. Under 300 words.",
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
