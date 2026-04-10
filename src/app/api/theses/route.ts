import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { getSupabaseWithUser } from "@/lib/supabase-server";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

interface RawThesis {
  title: string;
  conviction: string;
  rationale: string;
  sector: string;
  catalyst: string;
  catalyst_note?: string;
  evidence_chain?: unknown;
  supporting_article_ids?: string[];
}

function validateThesis(t: unknown): t is RawThesis {
  if (!t || typeof t !== "object") return false;
  const obj = t as Record<string, unknown>;
  return (
    typeof obj.title === "string" && obj.title.length > 0 &&
    typeof obj.conviction === "string" && obj.conviction.length > 0 &&
    typeof obj.sector === "string" && obj.sector.length > 0
  );
}

export async function POST() {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    let prompt = "";
    const validIds = new Set<string>();

    // 1. Prefer today's trend_clusters as the structured input
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { data: latestClusterRow } = await supabase
      .from("trend_clusters")
      .select("run_id")
      .gte("created_at", todayStart.toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestClusterRow?.run_id) {
      const { data: clusters } = await supabase
        .from("trend_clusters")
        .select(
          "label, cluster_type, source_count, top_companies, top_sectors, representative_article_ids, strength_score"
        )
        .eq("run_id", latestClusterRow.run_id)
        .order("strength_score", { ascending: false, nullsFirst: false })
        .limit(6);

      if (clusters && clusters.length > 0) {
        // Up to 3 article ids per cluster
        const clusterArticleIds: string[][] = clusters.map((c) => {
          const raw = c.representative_article_ids;
          return Array.isArray(raw) ? (raw as string[]).slice(0, 3) : [];
        });
        const allIds = Array.from(new Set(clusterArticleIds.flat()));

        if (allIds.length > 0) {
          const { data: clusterArticles } = await supabase
            .from("articles")
            .select("id, title, summary, sector, ingested_at, content_type")
            .in("id", allIds);

          if (clusterArticles && clusterArticles.length > 0) {
            type ClusterArticle = (typeof clusterArticles)[number];
            clusterArticles.forEach((a) => validIds.add(a.id));
            const articleMap = new Map<string, ClusterArticle>(
              clusterArticles.map((a) => [a.id, a])
            );

            const clusterBlocks = clusters
              .map((c, i) => {
                const arts: ClusterArticle[] = clusterArticleIds[i]
                  .map((id) => articleMap.get(id))
                  .filter((a): a is ClusterArticle => Boolean(a));
                const topCompanies = Array.isArray(c.top_companies)
                  ? (c.top_companies as string[]).slice(0, 5).join(", ")
                  : "";
                const topSectors = Array.isArray(c.top_sectors)
                  ? (c.top_sectors as string[]).slice(0, 3).join(", ")
                  : "";
                const articleLines =
                  arts
                    .map(
                      (a) =>
                        `  - id=${a.id} | ${a.title}${a.summary ? " — " + a.summary.slice(0, 140) : ""}`
                    )
                    .join("\n") || "  (no articles resolved)";
                return `Cluster ${i + 1}: ${c.label || "(unlabeled)"}
Type: ${c.cluster_type || "unknown"} | Sources: ${c.source_count ?? 0}
Top companies: ${topCompanies || "—"}
Top sectors: ${topSectors || "—"}
Articles:
${articleLines}`;
              })
              .join("\n\n");

            prompt = `You are analyzing ${clusters.length} market narrative clusters from today's news pipeline. Each cluster represents a group of related articles. Generate exactly 3-5 investment theses, one per dominant cluster. For each thesis return:
- title
- conviction (HIGH/MEDIUM/WATCH)
- sector
- rationale (3-4 sentences with specific companies and data)
- catalyst
- supporting_article_ids (array of article IDs from the cluster that support this thesis)

Clusters:
${clusterBlocks}

Respond ONLY with a JSON array. No markdown. Each thesis MUST include supporting_article_ids — exact UUID strings copied from the id= values in the clusters above. Do NOT invent IDs.

Format: [{"title":"5-8 words","conviction":"HIGH|MEDIUM|WATCH","sector":"Technology M&A|Private Equity|Venture Capital|Public Markets|Geopolitics & Macro|Fintech & Crypto|Healthcare & Biotech|Energy & Climate","rationale":"3-4 sentences citing specific companies and data","catalyst":"Near-term catalyst with timeframe","catalyst_note":"2-3 sentences on why the catalyst matters","supporting_article_ids":["uuid-from-cluster","..."],"evidence_chain":[{"label":"2-4 words","type":"support|context|risk","bridge":"One sentence linking article to thesis"}]}]`;
          }
        }
      }
    }

    // 2. Fallback: raw article fetch if no clusters were usable
    if (validIds.size === 0) {
      const { data: articles, error: articlesError } = await supabase
        .from("articles")
        .select(
          "id, title, summary, sector, sentiment, companies, deal_type, source"
        )
        .order("ingested_at", { ascending: false })
        .limit(15);

      if (articlesError) throw articlesError;
      if (!articles || articles.length === 0) {
        return NextResponse.json({ theses: [] });
      }

      articles.forEach((a) => validIds.add(a.id));

      const articleContext = articles
        .map(
          (a) =>
            `id=${a.id} | ${a.sector || "General"} | ${a.title}${a.summary ? " — " + a.summary.slice(0, 120) : ""}`
        )
        .join("\n");

      const exampleId1 = articles[0]?.id || "example-uuid";
      const exampleId2 = articles[1]?.id || "example-uuid-2";

      prompt = `You are a senior IB analyst. Generate 3-5 high-conviction investment theses from these articles. Be selective — quality over quantity.

Each line below is one article: "id=UUID | sector | title — summary". The id is the UUID you MUST copy into supporting_article_ids for theses that cite that article.

ARTICLES:
${articleContext}

Respond ONLY with a JSON array. No markdown. Each thesis MUST include supporting_article_ids — 2-3 exact UUID strings copied from the id= values above (e.g. "${exampleId1}", "${exampleId2}"). Do NOT invent IDs.

Format:
[{"title":"5-8 words","conviction":"BULLISH|BEARISH|WATCH","rationale":"3-4 sentences citing specific companies/figures","sector":"Technology M&A|Private Equity|Venture Capital|Public Markets|Geopolitics & Macro|Fintech & Crypto|Healthcare & Biotech|Energy & Climate","catalyst":"Near-term catalyst with timeframe","catalyst_note":"2-3 sentences on why the catalyst matters","supporting_article_ids":["${exampleId1}","${exampleId2}"],"evidence_chain":[{"label":"2-4 words","type":"support|context|risk","bridge":"One sentence linking article to thesis"}]}]

Rules:
- 3-5 theses max
- supporting_article_ids: 2-3 exact UUIDs from articles above (critical — do not fake)
- evidence_chain: 2-3 items citing exact names/figures
- BULLISH/BEARISH only with strong converging signal; WATCH if ambiguous
- No generic sector overviews`;
    }

    const completion = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        temperature: 0.3,
        maxOutputTokens: 2000,
        responseMimeType: "application/json",
      },
    });

    const raw = completion.text || "";
    console.log("[theses] Raw Gemini response:", raw);

    let theses: RawThesis[] = [];
    try {
      const cleaned = raw.replace(/```json|```/g, "").trim();
      let parsed: unknown = null;

      // Primary: try parsing the whole cleaned response
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        // Fallback 1: extract first JSON array
        const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
          try {
            parsed = JSON.parse(arrayMatch[0]);
          } catch {
            parsed = null;
          }
        }
        // Fallback 2: extract first JSON object and wrap it
        if (parsed === null) {
          const objectMatch = cleaned.match(/\{[\s\S]*\}/);
          if (objectMatch) {
            try {
              const obj = JSON.parse(objectMatch[0]);
              parsed = Array.isArray(obj) ? obj : [obj];
            } catch {
              parsed = null;
            }
          }
        }
      }

      if (parsed === null) {
        console.error("[theses] Failed to extract JSON from Gemini response. Raw content:", raw);
        return NextResponse.json(
          { error: "Failed to parse thesis response", detail: "No JSON array or object found in Gemini output" },
          { status: 500 }
        );
      }

      if (!Array.isArray(parsed)) {
        console.error("[theses] Parsed response was not an array:", parsed);
        return NextResponse.json(
          { error: "AI response was not an array" },
          { status: 500 }
        );
      }

      theses = parsed.filter(validateThesis).slice(0, 5);
    } catch (parseErr) {
      console.error("[theses] Unexpected parse error:", parseErr, "Raw content:", raw);
      return NextResponse.json(
        { error: "Failed to parse thesis response", detail: parseErr instanceof Error ? parseErr.message : String(parseErr) },
        { status: 500 }
      );
    }

    if (theses.length === 0) {
      return NextResponse.json(
        { error: "Gemini returned no valid theses — retry" },
        { status: 500 }
      );
    }

    // Dedup: delete any AI-generated theses from today before inserting
    const dedupCutoff = new Date();
    dedupCutoff.setHours(0, 0, 0, 0);
    await supabase
      .from("theses")
      .delete()
      .eq("source", "ai-generated")
      .gte("generated_at", dedupCutoff.toISOString());

    const rows = theses.map(
      (t) => ({
        title: t.title,
        conviction: t.conviction,
        rationale: t.rationale,
        sector: t.sector,
        catalyst: t.catalyst,
        catalyst_note: t.catalyst_note || null,
        evidence_chain: t.evidence_chain || null,
        supporting_articles: Array.isArray(t.supporting_article_ids)
          ? t.supporting_article_ids.filter((id) => validIds.has(id))
          : null,
        status: "new-signal",
        generated_at: new Date().toISOString(),
        source: "ai-generated",
      })
    );

    const { error: insertError } = await supabase.from("theses").insert(rows);
    if (insertError) {
      console.error("Supabase insert error:", insertError);
      return NextResponse.json(
        { error: "Failed to save theses", detail: insertError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ theses, count: theses.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Theses API error:", message);
    return NextResponse.json(
      { error: "Failed to generate theses", detail: message },
      { status: 500 }
    );
  }
}
