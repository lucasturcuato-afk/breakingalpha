import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import { createClient } from "@supabase/supabase-js";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(request: NextRequest) {
  const { thesis, articles, thesisId } = await request.json();
  if (!thesis)
    return NextResponse.json(
      { error: "thesis is required" },
      { status: 400 }
    );

  const articleList = (articles || []).slice(0, 8);
  const articleContext = articleList
    .map(
      (a: { title: string; source?: string; summary?: string }, i: number) =>
        `${i + 1}. "${a.title}" (${a.source || "Unknown"})${a.summary ? "\n   Summary: " + a.summary.slice(0, 200) : ""}`
    )
    .join("\n\n");

  const prompt = `You are a senior equity research analyst. Given a thesis and source articles, generate a catalyst note and evidence chain.

THESIS: ${thesis.title} (${thesis.conviction}, ${thesis.sector || "General"})
Analysis: ${(thesis.rationale || "").slice(0, 200)}
Catalyst: ${thesis.catalyst || "None"}

ARTICLES:
${articleContext || "None"}

Respond ONLY with valid JSON:
{
  "catalyst_note": "2-3 sentences: what the catalyst is with timing, why it matters structurally (cite specific figures), what metric to watch.",
  "evidence": [
    {"article_index": 0, "label": "2-4 word tag", "type": "support" or "context" or "risk", "bridge": "One sentence connecting article to thesis with specific data."}
  ]
}

Rules: one evidence entry per article (${articleList.length} total), cite specific companies/figures, no generic statements.`;

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1200,
      temperature: 0.3,
    });

    const raw = completion.choices[0]?.message?.content || "{}";
    let parsed: { catalyst_note?: string; evidence?: unknown } = {};
    try {
      parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
    } catch {
      return NextResponse.json(
        { error: "Failed to parse AI response" },
        { status: 500 }
      );
    }

    if (thesisId && (parsed.catalyst_note || parsed.evidence)) {
      try {
        const updateData: Record<string, unknown> = {};
        if (parsed.catalyst_note) updateData.catalyst_note = parsed.catalyst_note;
        if (parsed.evidence) updateData.evidence_chain = parsed.evidence;
        await supabase.from("theses").update(updateData).eq("id", thesisId);
      } catch (e) {
        console.error("Failed to save enrichment to Supabase:", e);
      }
    }

    return NextResponse.json(parsed, {
      headers: {
        "Cache-Control": "s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (err) {
    console.error("Thesis detail error:", err);
    return NextResponse.json(
      { error: "Failed to generate thesis detail" },
      { status: 500 }
    );
  }
}
