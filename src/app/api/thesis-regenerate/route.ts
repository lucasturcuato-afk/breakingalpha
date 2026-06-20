import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { enforceThesisRecommendation, hasThesisViolation } from "@/lib/thesis-recommendation-guard";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function POST(request: NextRequest) {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { thesisId } = body as { thesisId?: string };
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

Cite specific companies, figures, and deal values from the articles. Structure: key data point → sector implications → forward outlook matching ${thesis.conviction} conviction. INFORMATIONAL ONLY, NOT advice: this is descriptive analysis. Never recommend a vehicle or instrument and never use buy/sell/long/short/avoid/overweight/underweight/recommend/"the cleanest expression is [ticker]"/"best way to play"/"increase exposure"/"add to position" phrasing. Name a security only as the SUBJECT of analysis, never as something to trade. Respond with ONLY the paragraph text, no labels or markdown.`;

    const analysisCompletion = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: analysisPrompt }] }],
      config: {
        temperature: 0.35,
        maxOutputTokens: 400,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    let newRationale =
      analysisCompletion.text?.trim() ||
      thesis.rationale ||
      "";

    // Recommendation guard: keep the regenerated thesis informational-only.
    // Runs over the title + regenerated rationale; touches only those (the
    // grader's structured fields are untouched). Detect -> one bounded re-ask
    // -> fail-closed redaction. Mirrors the #389 brief-voice guard. Non-fatal.
    let guardedTitle: string | null = null;
    try {
      if (hasThesisViolation(thesis.title, newRationale)) {
        const enforced = await enforceThesisRecommendation(thesis.title || "", newRationale, {
          regenerate: async (correction) => {
            try {
              const resp = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: [
                  {
                    role: "user",
                    parts: [
                      {
                        text:
                          "Rewrite this single investment thesis to comply, preserving the same companies, facts, catalyst, and structure.\n\n" +
                          `CURRENT TITLE: ${thesis.title || ""}\n` +
                          `CURRENT RATIONALE: ${newRationale}\n\n` +
                          `${correction}\n\n` +
                          'Return ONLY a JSON object: {"title": "...", "rationale": "..."}',
                      },
                    ],
                  },
                ],
                config: {
                  temperature: 0.3,
                  maxOutputTokens: 600,
                  responseMimeType: "application/json",
                  thinkingConfig: { thinkingBudget: 0 },
                },
              });
              const cleaned = (resp.text || "").replace(/```json|```/g, "").trim();
              const m = cleaned.match(/\{[\s\S]*\}/);
              if (!m) return null;
              const obj = JSON.parse(m[0]);
              if (typeof obj?.title !== "string" || typeof obj?.rationale !== "string") return null;
              return { title: obj.title, rationale: obj.rationale };
            } catch {
              return null;
            }
          },
          maxReasks: 1,
        });
        newRationale = enforced.rationale;
        if (enforced.title && enforced.title !== thesis.title) guardedTitle = enforced.title;
      }
    } catch (guardErr) {
      console.warn(
        "Thesis guard error (non-fatal):",
        guardErr instanceof Error ? guardErr.message : String(guardErr),
      );
    }

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

    const detailCompletion = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: detailPrompt }] }],
      config: {
        temperature: 0.3,
        maxOutputTokens: 1200,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    let catalystNote = "";
    let evidenceChain: unknown[] = [];
    try {
      const cleaned = (detailCompletion.text || "{}")
        .replace(/```json|```/g, "")
        .trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON object found in response");
      const parsed = JSON.parse(jsonMatch[0]);
      catalystNote = parsed.catalyst_note || "";
      evidenceChain = parsed.evidence || [];
    } catch {
      // Parse failed — still save rationale
    }

    const updateData: Record<string, unknown> = { rationale: newRationale };
    if (guardedTitle) updateData.title = guardedTitle;
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
        ...(guardedTitle ? { title: guardedTitle } : {}),
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
