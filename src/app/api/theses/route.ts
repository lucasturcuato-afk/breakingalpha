import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseWithUser } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

// ── Phase 0.1: thesis_notes DDL (printed on first GET) ──
const THESIS_NOTES_DDL = `
create table if not exists public.thesis_notes (
  id uuid primary key default gen_random_uuid(),
  thesis_id uuid not null references public.theses(id) on delete cascade,
  content text not null default '',
  updated_at timestamptz not null default now(),
  unique (thesis_id)
);
create index if not exists thesis_notes_thesis_id_idx on public.thesis_notes(thesis_id);
`;

// ── GET /api/theses — fetch theses with dedupe + digest ──
export async function GET() {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Print DDL for thesis_notes (informational)
  console.log("[theses GET] thesis_notes DDL (run in Supabase SQL editor if not already applied):");
  console.log(THESIS_NOTES_DDL);

  try {
    // Fetch theses with optional thesis_notes join
    let theses: Record<string, unknown>[] = [];
    try {
      const { data, error: thesesErr } = await supabase
        .from("theses")
        .select(
          "id, title, rationale, sector, conviction, catalyst, catalyst_note, " +
          "bear_case, adversarial_score, passed_adversarial, outcome, outcome_notes, " +
          "signal_breakdown, evidence_chain, supporting_articles, ticker, horizon, " +
          "check_after, status, generated_at, source, verifiable_signal, " +
          "thesis_notes(content, updated_at)"
        )
        .order("generated_at", { ascending: false })
        .limit(100);
      if (thesesErr) {
        console.warn("[theses GET] thesis join failed, retrying without notes:", thesesErr.message);
        // Fallback: fetch without the thesis_notes join
        const { data: fallback, error: fallbackErr } = await supabase
          .from("theses")
          .select("*")
          .order("generated_at", { ascending: false })
          .limit(100);
        if (fallbackErr) throw fallbackErr;
        theses = (fallback || []) as unknown as Record<string, unknown>[];
      } else {
        theses = (data || []) as unknown as Record<string, unknown>[];
      }
    } catch (e) {
      console.error("[theses GET] theses fetch failed:", e);
      return NextResponse.json({ theses: [], digest: null, error: "Failed to fetch theses" });
    }

    // Flatten thesis_notes into a top-level `notes` field
    theses = theses.map((t) => {
      const notesJoin = t.thesis_notes;
      let notes: string | null = null;
      if (Array.isArray(notesJoin) && notesJoin.length > 0) {
        notes = (notesJoin[0] as Record<string, unknown>).content as string || null;
      } else if (notesJoin && typeof notesJoin === "object" && !Array.isArray(notesJoin)) {
        notes = (notesJoin as Record<string, unknown>).content as string || null;
      }
      const { thesis_notes: _, ...rest } = t;
      return { ...rest, notes };
    });

    // Phase 0.2: In-memory fuzzy deduplication by first-40-char prefix
    const titleMap = new Map<string, Record<string, unknown>>();
    let dupeCount = 0;
    for (const t of theses) {
      const fullTitle = (String(t.title || "")).trim().toLowerCase();
      const key = fullTitle.slice(0, 40);
      const existing = titleMap.get(key);
      if (existing) {
        dupeCount++;
        const existTitle = String(existing.title || "");
        const newTitle = String(t.title || "");
        // Keep the one with the longer title (more descriptive)
        if (newTitle.length > existTitle.length) {
          titleMap.set(key, t);
        } else if (newTitle.length === existTitle.length) {
          // Tie-break: keep more recent generated_at
          const existDate = new Date(String(existing.generated_at || "")).getTime();
          const newDate = new Date(String(t.generated_at || "")).getTime();
          if (newDate > existDate) {
            titleMap.set(key, t);
          }
        }
      } else {
        titleMap.set(key, t);
      }
    }
    if (dupeCount > 0) {
      console.log(`[theses GET] deduplicated ${dupeCount} theses by 40-char prefix`);
    }
    theses = Array.from(titleMap.values());

    // Fetch latest weekly digest
    let digest: Record<string, unknown> | null = null;
    try {
      const { data: digestRow, error: digestErr } = await supabase
        .from("weekly_digests")
        .select("id, generated_at, thesis_prompt_addendum")
        .order("generated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (digestErr) {
        console.warn("[theses GET] weekly_digests lookup failed:", digestErr.message);
      } else {
        digest = digestRow as Record<string, unknown> | null;
      }
    } catch (e) {
      console.warn("[theses GET] weekly_digests threw:", e);
    }

    return NextResponse.json({ theses, digest });
  } catch (err) {
    console.error("[theses GET] unexpected error:", err);
    return NextResponse.json({ theses: [], digest: null, error: "Internal server error" });
  }
}

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
  // Phase 2: autonomous grading fields extracted by Gemini
  ticker?: string | null;
  horizon?: "7d" | "30d" | "90d";
  verifiable_signal?: string;
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

// Phase 2: compute check_after from generated_at + horizon
function computeCheckAfter(generatedAtIso: string, horizon: string | undefined): string {
  const days = horizon === "7d" ? 7 : horizon === "90d" ? 90 : 30;
  const d = new Date(generatedAtIso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

export async function POST() {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const validIds = new Set<string>();

    // Service-role client for pipeline tables (not gated on user session/RLS)
    const adminSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    // 1. Pull the most recent run_id from trend_clusters within the last 48h
    const lookbackIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: latestClusterRow } = await adminSupabase
      .from("trend_clusters")
      .select("run_id, brief_type")
      .gte("created_at", lookbackIso)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!latestClusterRow?.run_id) {
      return NextResponse.json(
        { error: "No pipeline data found in the last 7 days. Please trigger a pipeline run." },
        { status: 503 }
      );
    }

    // 2. Fetch up to 10 clusters for that run, ranked by strength_score DESC
    const { data: clusters } = await adminSupabase
      .from("trend_clusters")
      .select(
        "label, cluster_type, source_count, strength_score, top_companies, top_sectors, representative_article_ids"
      )
      .eq("run_id", latestClusterRow.run_id)
      .order("strength_score", { ascending: false, nullsFirst: false })
      .limit(10);

    if (!clusters || clusters.length === 0) {
      return NextResponse.json(
        { error: "No clusters available — pipeline must run first" },
        { status: 503 }
      );
    }

    // Up to 3 article ids per cluster
    const clusterArticleIds: string[][] = clusters.map((c) => {
      let raw = c.representative_article_ids;
      if (typeof raw === "string") {
        try { raw = JSON.parse(raw); } catch { return []; }
      }
      return Array.isArray(raw) ? (raw as string[]).slice(0, 3) : [];
    });
    const allIds = new Set<string>();
    clusters.forEach((c) => {
      let ids = c.representative_article_ids;
      if (!ids) return;
      // Parse if returned as a string
      if (typeof ids === "string") {
        try { ids = JSON.parse(ids); } catch { return; }
      }
      if (!Array.isArray(ids)) return;
      ids.slice(0, 3).forEach((item: unknown) => {
        if (typeof item === "string") {
          allIds.add(item);
        } else if (Array.isArray(item)) {
          item.forEach((id: string) => allIds.add(id));
        }
      });
    });

    if (allIds.size === 0) {
      return NextResponse.json(
        { error: "No clusters available — pipeline must run first" },
        { status: 503 }
      );
    }

    const { data: clusterArticles } = await adminSupabase
      .from("articles")
      .select("id, title, summary, sector, ingested_at, content_type")
      .in("id", Array.from(allIds));

    if (!clusterArticles || clusterArticles.length === 0) {
      return NextResponse.json(
        { error: "No clusters available — pipeline must run first" },
        { status: 503 }
      );
    }

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
          ? (c.top_companies as string[]).slice(0, 3).join(", ")
          : "";
        const topSectors = Array.isArray(c.top_sectors)
          ? (c.top_sectors as string[]).slice(0, 2).join(", ")
          : "";
        const strengthStr =
          typeof c.strength_score === "number" ? c.strength_score.toFixed(2) : "—";
        const articleLines =
          arts
            .map(
              (a) =>
                `  - id=${a.id} | content_type=${a.content_type || "snippet"} | ${a.title}${a.summary ? " — " + a.summary.slice(0, 200) : ""}`
            )
            .join("\n") || "  (no articles resolved)";
        return `Cluster ${i + 1}: ${c.label || "(unlabeled)"}
  cluster_type: ${c.cluster_type || "unknown"}
  source_count: ${c.source_count ?? 0}
  strength_score: ${strengthStr}
  top_companies: ${topCompanies || "—"}
  top_sectors: ${topSectors || "—"}
  articles:
${articleLines}`;
      })
      .join("\n\n");

    // Fetch weekly pipeline feedback addendum — non-blocking, best-effort.
    // If weekly_digests is empty, brief_type is unknown, the query fails,
    // or no addendum exists for this brief_type, thesis generation continues
    // normally with no addendum. Never blocks or crashes the main flow.
    let thesisAddendum: string | null = null;
    try {
      const briefType = latestClusterRow.brief_type;
      if (typeof briefType === "string" && briefType.length > 0) {
        const { data: addendumRow, error: addendumErr } = await supabase
          .from("weekly_digests")
          .select("thesis_prompt_addendum")
          .eq("brief_type", briefType)
          .order("generated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (addendumErr) {
          console.log(
            "[theses] weekly_digests lookup failed (continuing):",
            addendumErr.message
          );
        } else if (addendumRow?.thesis_prompt_addendum) {
          thesisAddendum = addendumRow.thesis_prompt_addendum as string;
          console.log(
            `[theses] Injecting weekly pipeline feedback addendum for brief_type=${briefType}`
          );
        }
      }
    } catch (addendumErr) {
      console.log(
        "[theses] weekly_digests lookup threw (continuing):",
        addendumErr instanceof Error ? addendumErr.message : String(addendumErr)
      );
    }

    const addendumBlock = thesisAddendum
      ? `WEEKLY PIPELINE FEEDBACK — incorporate into thesis framing:\n${thesisAddendum}\n\n`
      : "";

    // Phase 6: inject high-win-rate historical patterns so Gemini knows
    // which (sector, horizon, dominant_signal) combinations have actually
    // paid off historically. Best-effort — never blocks generation.
    let patternBlock = "";
    try {
      const { data: patternRows, error: patternErr } = await supabase
        .from("pattern_library")
        .select("sector, horizon, dominant_signal, n_observed, n_confirmed, win_rate")
        .gte("n_observed", 5)
        .order("win_rate", { ascending: false })
        .limit(5);
      if (patternErr) {
        console.log(
          "[theses] pattern_library lookup failed (continuing):",
          patternErr.message
        );
      } else if (patternRows && patternRows.length > 0) {
        const lines = patternRows
          .map((p) => {
            const wr =
              typeof p.win_rate === "number"
                ? (p.win_rate * 100).toFixed(0) + "%"
                : "—";
            return `  - ${p.sector || "Unknown"} / ${p.horizon || "30d"} / ${p.dominant_signal || "mixed"}: ${p.n_confirmed ?? 0}/${p.n_observed ?? 0} confirmed (${wr})`;
          })
          .join("\n");
        patternBlock = `HISTORICAL PATTERN PERFORMANCE — prefer thesis framings that match high-win-rate patterns below. Each line is (sector / horizon / dominant_signal) with the historical confirm rate:\n${lines}\n\n`;
        console.log(
          `[theses] Injecting ${patternRows.length} historical patterns into prompt`
        );
      }
    } catch (patternErr) {
      console.log(
        "[theses] pattern_library lookup threw (continuing):",
        patternErr instanceof Error ? patternErr.message : String(patternErr)
      );
    }

    const prompt = `You are a senior investment banking analyst at a top-tier firm (Goldman Sachs, Blackstone, KKR level). You have been given today's market narrative clusters, each representing a group of related news articles that have been algorithmically clustered by topic, company, and sector.

Your job is to synthesize these clusters into 3-5 high-conviction investment theses that a portfolio manager or deal team would actually act on.

STRICT REQUIREMENTS for each thesis:
- Must be grounded in SPECIFIC companies, figures, and events from the cluster data provided
- Must identify a clear market catalyst (what happened and why it matters NOW)
- Must have a testable claim (something that will either prove or disprove the thesis in 30-90 days)
- Rationale must be 3-4 sentences minimum, IB-grade language
- conviction must be exactly one of: HIGH, MEDIUM, or WATCH
- HIGH = strong signal across multiple sources, clear catalyst
- MEDIUM = emerging signal, needs confirmation
- WATCH = early signal, monitor closely

QUALITY RULES:
- Be selective. Only generate a thesis if there is genuine signal. Do not generate a thesis for every cluster.
- Never generate generic market commentary. Every thesis must name specific companies, sectors, or macro events.
- Prioritize clusters with higher strength_score and source_count — these have the most corroborating evidence.
- supporting_article_ids must contain the EXACT article IDs from the cluster data (the id= values shown). Minimum 2 IDs per thesis.

Return a JSON array only. Each object must have exactly these fields:
{
  title: string (8 words max, specific and actionable),
  conviction: HIGH | MEDIUM | WATCH,
  sector: string,
  rationale: string (3-4 sentences, specific companies and data),
  catalyst: string (1-2 sentences, what triggered this),
  supporting_article_ids: string[] (minimum 2 article IDs),
  ticker: string | null (single primary US ticker this thesis can be graded against — e.g. "AAPL", "MSFT", or null if the thesis is macro/sector and has no one primary ticker),
  horizon: "7d" | "30d" | "90d" (how long until this thesis should be graded — match the catalyst timing),
  verifiable_signal: string (ONE sentence stating a concrete, falsifiable outcome that will confirm or invalidate the thesis — e.g. "AAPL closes above $230 within 30 days" or "TSLA Q2 earnings beat consensus by >5%")
}

${addendumBlock}${patternBlock}CLUSTERS:
${clusterBlocks}`;

    const completion = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        temperature: 0.3,
        maxOutputTokens: 2000,
        responseMimeType: "application/json",
        thinkingConfig: { thinkingBudget: 0 },
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

    const generatedAtIso = new Date().toISOString();
    const rows = theses.map(
      (t) => {
        const horizon = t.horizon === "7d" || t.horizon === "90d" ? t.horizon : "30d";
        const ticker = typeof t.ticker === "string" && t.ticker.trim().length > 0
          ? t.ticker.trim().toUpperCase()
          : null;
        return {
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
          generated_at: generatedAtIso,
          source: "ai-generated",
          // Phase 2: autonomous grading fields
          ticker,
          horizon,
          verifiable_signal: typeof t.verifiable_signal === "string" ? t.verifiable_signal : null,
          check_after: computeCheckAfter(generatedAtIso, horizon),
        };
      }
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
