// RPC function for vector similarity search (run in Supabase SQL editor)
// CREATE OR REPLACE FUNCTION match_content_embeddings(
//   query_embedding vector(768),
//   match_threshold float,
//   match_count int
// ) RETURNS TABLE (
//   id uuid,
//   content_type text,
//   content_id uuid,
//   similarity float
// ) LANGUAGE sql STABLE AS $$
//   SELECT id, content_type, content_id,
//     1 - (embedding <=> query_embedding) AS similarity
//   FROM content_embeddings
//   WHERE 1 - (embedding <=> query_embedding) > match_threshold
//   ORDER BY embedding <=> query_embedding
//   LIMIT match_count;
// $$;

import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { checkRateLimit } from "@/lib/rate-limit";
import { cacheGet, cacheSet, buildCacheKey } from "@/lib/response-cache";
import { getUserProfile, buildPersonalizationContext } from "@/lib/user-profile";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const SYSTEM_PROMPT =
  "You are Signalera Intelligence, an AI research analyst assistant. " +
  "You have access to the user's curated market intelligence — articles, investment theses, and market briefings. " +
  "Answer questions using ONLY the provided context. If the context doesn't contain relevant information, say so honestly. " +
  "Be specific, cite sources by title, and maintain an analyst's tone. Never invent facts.";

const RATE_LIMIT_CHAT = 20; // messages per 24h

const EMPTY_KB_RESPONSE =
  "I don't have enough research data yet. The knowledge base will populate after the next pipeline run.";

interface HistoryEntry {
  role: "user" | "model";
  text: string;
}

interface MatchRow {
  id: string;
  content_type: string;
  content_id: string;
  similarity: number;
}

interface SourceInfo {
  type: string;
  title: string;
  id: string;
}

interface CachedResponse {
  response: string;
  sources: SourceInfo[];
}

export async function POST(request: NextRequest) {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  /* ── Step 1: Parse request body ── */
  let query: string;
  let history: HistoryEntry[] | undefined;
  try {
    const body = await request.json();
    // Accept "query" (preferred) or "message" (legacy)
    query = body.query ?? body.message ?? "";
    history = body.history;
  } catch (err) {
    console.error("[intelligence] Step 1 — parse body failed:", err);
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!query || typeof query !== "string") {
    return NextResponse.json(
      { error: "query is required and must be a string" },
      { status: 400 },
    );
  }

  /* ── Rate limit ── */
  const rl = checkRateLimit(user.id, "chat", RATE_LIMIT_CHAT);
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: `Rate limit exceeded — ${rl.limit} messages per day. Resets ${new Date(rl.resetAt).toLocaleTimeString()}.`,
        remaining: 0,
        resetAt: rl.resetAt,
      },
      { status: 429 },
    );
  }

  /* ── Cache check (only for first message, no history) ── */
  const isFirstMessage = !history || history.length === 0;
  const cacheKey = buildCacheKey(user.id, query);

  if (isFirstMessage) {
    const cached = cacheGet<CachedResponse>(cacheKey);
    if (cached) {
      return NextResponse.json({
        response: cached.response,
        sources: cached.sources,
        remaining: rl.remaining,
        cached: true,
      });
    }
  }

  /* ── Step 2: Embed the user's query ── */
  let embedding: number[];
  try {
    const embedResponse = await ai.models.embedContent({
      model: "gemini-embedding-exp-03-07",
      contents: query,
      config: { outputDimensionality: 768 },
    });

    const values = embedResponse.embeddings?.[0]?.values;
    if (!values) {
      console.error("[intelligence] Step 2 — embedding returned no values");
      return NextResponse.json(
        { error: "Failed to generate embedding" },
        { status: 500 },
      );
    }
    embedding = values;
  } catch (err) {
    console.error("[intelligence] Step 2 — embed query failed:", err);
    return NextResponse.json(
      { error: "Failed to generate embedding" },
      { status: 500 },
    );
  }

  /* ── Step 3: Search embeddings via RPC ── */
  let typedMatches: MatchRow[];
  try {
    const { data: matches, error: matchError } = await supabase.rpc(
      "match_content_embeddings",
      {
        query_embedding: JSON.stringify(embedding),
        match_threshold: 0.5,
        match_count: 8,
      },
    );

    if (matchError) {
      console.error("[intelligence] Step 3 — match_content_embeddings error:", matchError);
      // If the RPC doesn't exist yet, give a helpful message
      if (matchError.message?.includes("function") || matchError.code === "42883") {
        return NextResponse.json(
          { error: "Vector search is not configured yet. Run the match_content_embeddings SQL function in Supabase." },
          { status: 503 },
        );
      }
      return NextResponse.json(
        { error: "Vector search failed" },
        { status: 500 },
      );
    }

    typedMatches = (matches ?? []) as MatchRow[];
  } catch (err) {
    console.error("[intelligence] Step 3 — RPC call failed:", err);
    return NextResponse.json(
      { error: "Vector search failed" },
      { status: 500 },
    );
  }

  /* ── Empty results: graceful 200 ── */
  if (typedMatches.length === 0) {
    return NextResponse.json({
      response: EMPTY_KB_RESPONSE,
      sources: [],
      remaining: rl.remaining,
    });
  }

  /* ── Step 4: Fetch full content for matched IDs ── */
  const sources: SourceInfo[] = [];
  const contextChunks: string[] = [];

  try {
    const articleIds = typedMatches.filter((m) => m.content_type === "article").map((m) => m.content_id);
    const thesisIds = typedMatches.filter((m) => m.content_type === "thesis").map((m) => m.content_id);

    const [articlesResult, thesesResult] = await Promise.all([
      articleIds.length > 0
        ? supabase.from("articles").select("id, title, summary, source").in("id", articleIds)
        : Promise.resolve({ data: [] as { id: string; title: string; summary: string; source: string }[] }),
      thesisIds.length > 0
        ? supabase.from("theses").select("id, title, sector, rationale, conviction, horizon").in("id", thesisIds)
        : Promise.resolve({ data: [] as { id: string; title: string; sector: string; rationale: string; conviction: string; horizon: string }[] }),
    ]);

    // Build lookup maps
    const articleMap = new Map((articlesResult.data ?? []).map((a) => [a.id, a]));
    const thesisMap = new Map((thesesResult.data ?? []).map((t) => [t.id, t]));

    // Maintain match order (by similarity) when building context
    for (const match of typedMatches) {
      if (match.content_type === "article") {
        const article = articleMap.get(match.content_id);
        if (article) {
          sources.push({ type: "article", title: article.title, id: article.id });
          contextChunks.push(
            `[Article: "${article.title}" — ${article.source || "unknown source"}]\n${article.summary || "No summary available."}`,
          );
        }
      } else if (match.content_type === "thesis") {
        const thesis = thesisMap.get(match.content_id);
        if (thesis) {
          sources.push({ type: "thesis", title: thesis.title || `${thesis.sector} thesis`, id: thesis.id });
          contextChunks.push(
            `[Thesis: "${thesis.title}" — ${thesis.sector} (${thesis.conviction}, ${thesis.horizon || "medium-term"})]\n${thesis.rationale || "No rationale available."}`,
          );
        }
      }
    }
  } catch (err) {
    console.error("[intelligence] Step 4 — fetch content failed:", err);
    return NextResponse.json(
      { error: "Failed to fetch matched content" },
      { status: 500 },
    );
  }

  /* ── Step 5: Generate response with Gemini ── */
  try {
    const profile = await getUserProfile(supabase, user.id);
    const personalizationCtx = buildPersonalizationContext(profile);
    const systemPrompt = personalizationCtx
      ? SYSTEM_PROMPT + "\n\nUSER PROFILE:\n" + personalizationCtx
      : SYSTEM_PROMPT;

    const contextBlock =
      contextChunks.length > 0
        ? "CONTEXT FROM YOUR INTELLIGENCE DATABASE:\n\n" +
          contextChunks.join("\n\n---\n\n") +
          "\n\n---\nAnswer the user's question based on the above context."
        : "No relevant context was found in your intelligence database. Let the user know.";

    const conversationContents: { role: "user" | "model"; parts: { text: string }[] }[] = [];

    // Prepend context as the first user message
    conversationContents.push({
      role: "user",
      parts: [{ text: contextBlock }],
    });
    conversationContents.push({
      role: "model",
      parts: [{ text: "Understood. I have the context loaded and will answer based only on this information." }],
    });

    // Add history
    if (history && Array.isArray(history)) {
      for (const entry of history) {
        conversationContents.push({
          role: entry.role,
          parts: [{ text: entry.text }],
        });
      }
    }

    // Add current message
    conversationContents.push({
      role: "user",
      parts: [{ text: query }],
    });

    const completion = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: conversationContents,
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.4,
        maxOutputTokens: 1500,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const response = completion.text;
    if (!response) {
      console.error("[intelligence] Step 5 — Gemini returned empty response");
      return NextResponse.json(
        { error: "Gemini returned an empty response — retry" },
        { status: 500 },
      );
    }

    /* ── Cache the response (first messages only) ── */
    if (isFirstMessage) {
      cacheSet<CachedResponse>(cacheKey, { response, sources });
    }

    return NextResponse.json({ response, sources, remaining: rl.remaining });
  } catch (err) {
    console.error("[intelligence] Step 5 — generate response failed:", err);
    return NextResponse.json(
      { error: "Failed to generate intelligence response" },
      { status: 500 },
    );
  }
}
