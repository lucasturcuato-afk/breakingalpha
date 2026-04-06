import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import { createClient } from "@supabase/supabase-js";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(request: NextRequest) {
  const { thesisId } = await request.json();
  if (!thesisId)
    return NextResponse.json(
      { error: "thesisId is required" },
      { status: 400 }
    );

  try {
    const { data: thesis, error: thesisErr } = await supabase
      .from("theses")
      .select("*")
      .eq("id", thesisId)
      .single();

    if (thesisErr || !thesis) {
      return NextResponse.json(
        { error: "Thesis not found" },
        { status: 404 }
      );
    }

    let query = supabase
      .from("articles")
      .select(
        "id, title, source, sector, published_at, ingested_at, summary, url, companies, sentiment"
      )
      .order("ingested_at", { ascending: false })
      .limit(12);
    if (thesis.sector) query = query.eq("sector", thesis.sector);
    const { data: articles } = await query;
    const articleList = (articles || []).slice(0, 8);

    const articleContext = articleList
      .map(
        (a, i) =>
          `${i + 1}. "${a.title}" (${a.source || "?"})${a.summary ? " — " + a.summary.slice(0, 120) : ""}`
      )
      .join("\n");

    // Step 1: Regenerate the full analysis (rationale)
    const analysisPrompt = `Write a 4-6 sentence analytical paragraph (80-120 words) about this investment thesis, in Bloomberg Intelligence style.

THESIS: ${thesis.title} (${thesis.conviction}, ${thesis.sector || "General"})
CATALYST: ${thesis.catalyst || "Not specified"}

ARTICLES:
${articleContext || "None"}

Cite specific companies, figures, and deal values from the articles. Structure: key data point → sector implications → forward outlook matching ${thesis.conviction} conviction. Respond with ONLY the paragraph text, no labels or markdown.`;

    const analysisCompletion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: analysisPrompt }],
      max_tokens: 400,
      temperature: 0.35,
    });
    const newRationale =
      analysisCompletion.choices[0]?.message?.content?.trim() ||
      thesis.rationale;

    // Step 2: Generate catalyst note + evidence chain
    const detailPrompt = `Given this thesis and articles, generate catalyst note and evidence chain.

THESIS: ${thesis.title} (${thesis.conviction}, ${thesis.sector || "General"})
Analysis: ${newRationale.slice(0, 200)}

ARTICLES:
${articleContext || "None"}

Respond ONLY with valid JSON:
{
  "catalyst_note": "2-3 sentences: what the catalyst is with timing, why it matters (cite figures), what to watch.",
  "evidence": [{"article_index": 0, "label": "2-4 word tag", "type": "support" or "context" or "risk", "bridge": "One sentence with specific data."}]
}
Rules: one entry per article (${articleList.length} total), cite specific data.`;

    const detailCompletion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: detailPrompt }],
      max_tokens: 1200,
      temperature: 0.3,
    });

    let catalystNote = "";
    let evidenceChain: unknown[] = [];
    try {
      const parsed = JSON.parse(
        (detailCompletion.choices[0]?.message?.content || "{}")
          .replace(/```json|```/g, "")
          .trim()
      );
      catalystNote = parsed.catalyst_note || "";
      evidenceChain = parsed.evidence || [];
    } catch {
      // Parse failed — still save rationale
    }

    const updateData: Record<string, unknown> = { rationale: newRationale };
    if (catalystNote) updateData.catalyst_note = catalystNote;
    if (evidenceChain.length > 0) updateData.evidence_chain = evidenceChain;

    const { error: updateErr } = await supabase
      .from("theses")
      .update(updateData)
      .eq("id", thesisId);

    if (updateErr) {
      console.error("Supabase update error:", updateErr);
    }

    return NextResponse.json({
      thesis: {
        ...thesis,
        rationale: newRationale,
        catalyst_note: catalystNote,
        evidence_chain: evidenceChain,
      },
    });
  } catch (err) {
    console.error("Thesis regenerate error:", err);
    return NextResponse.json(
      { error: "Failed to regenerate thesis" },
      { status: 500 }
    );
  }
}
