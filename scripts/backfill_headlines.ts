import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

function safeArray(val: unknown): string[] {
  if (Array.isArray(val)) return val;
  if (typeof val === "string") {
    try { const p = JSON.parse(val); return Array.isArray(p) ? p : []; }
    catch { return []; }
  }
  return [];
}

async function generateHeadline(cluster: Record<string, unknown>): Promise<{ headline: string; tagline: string }> {
  const label = cluster.label as string || "";
  const themes = safeArray(cluster.top_themes);
  const companies = safeArray(cluster.top_companies);
  const sectors = safeArray(cluster.top_sectors);
  const articleCount = cluster.article_count as number || 0;
  const sourceCount = cluster.source_count as number || 0;

  const prompt = `Generate a professional financial market signal headline and tagline.

Data: label="${label}", themes=[${themes.slice(0,5).join(", ")}], companies=[${companies.slice(0,5).join(", ")}], sectors=[${sectors.slice(0,3).join(", ")}], ${articleCount} articles from ${sourceCount} sources.

Rules:
- Headline: 5-8 words. Bloomberg terminal style. Focus on the MARKET TREND, not the company. Example: "Healthcare PE Consolidation Accelerates" not "Apollo: Pe".
- Tagline: One sentence, 15-25 words. Names key companies, explains why this matters.
- Professional. No hype.

Respond ONLY with JSON, no markdown, no code fences:
{"headline": "...", "tagline": "..."}`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: { temperature: 0.3, maxOutputTokens: 200, thinkingConfig: { thinkingBudget: 0 } },
    });
    let text = response.text?.trim() || "";
    if (text.startsWith("```")) text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    const parsed = JSON.parse(text);
    return { headline: parsed.headline || label, tagline: parsed.tagline || "" };
  } catch (err) {
    console.error(`  FAIL "${label}":`, (err as Error).message?.slice(0, 60));
    return { headline: label, tagline: "" };
  }
}

async function main() {
  const { data: clusters, error } = await supabase
    .from("trend_clusters")
    .select("id, label, top_themes, top_companies, top_sectors, article_count, source_count")
    .is("headline", null)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) { console.error("Fetch error:", error.message); return; }
  console.log(`${clusters?.length ?? 0} clusters need headlines`);
  if (!clusters?.length) return;

  let ok = 0, fail = 0;
  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i];
    process.stdout.write(`[${i+1}/${clusters.length}] ${(c.label as string || "").slice(0,50)}... `);
    const { headline, tagline } = await generateHeadline(c);
    const { error: err } = await supabase.from("trend_clusters").update({ headline, tagline }).eq("id", c.id);
    if (err) { console.log(`ERR: ${err.message}`); fail++; }
    else { console.log(`→ ${headline}`); ok++; }
    await new Promise(r => setTimeout(r, 500));
  }
  console.log(`\nDone. OK: ${ok}, Failed: ${fail}`);
}

main().catch(console.error);
