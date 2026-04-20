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

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const SYSTEM_PROMPT =
  "You are Signalera Intelligence, an AI research analyst assistant. " +
  "You have access to the user's curated market intelligence — articles, investment theses, and market briefings. " +
  "Answer questions using ONLY the provided context. If the context doesn't contain relevant information, say so honestly. " +
  "Be specific, cite sources by title, and maintain an analyst's tone. Never invent facts.";

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

export async function POST(request: NextRequest) {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { message?: string; history?: HistoryEntry[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { message, history } = body;
  if (!message || typeof message !== "string") {
    return NextResponse.json(
      { error: "message is required and must be a string" },
      { status: 400 },
    );
  }

  try {
    /* ── 1. Embed the user's message ── */
    const embedResponse = await ai.models.embedContent({
      model: "gemini-embedding-exp-03-07",
      contents: message,
    });

    const embedding = embedResponse.embeddings?.[0]?.values;
    if (!embedding) {
      return NextResponse.json(
        { error: "Failed to generate embedding" },
        { status: 500 },
      );
    }

    /* ── 2. Retrieve nearest neighbours via pgvector RPC ── */
    const { data: matches, error: matchError } = await supabase.rpc(
      "match_content_embeddings",
      {
        query_embedding: JSON.stringify(embedding),
        match_threshold: 0.5,
        match_count: 8,
      },
    );

    if (matchError) {
      console.error("[intelligence] match_content_embeddings error:", matchError);
      return NextResponse.json(
        { error: "Vector search failed" },
        { status: 500 },
      );
    }

    /* ── 3. Fetch full content for each match ── */
    const sources: SourceInfo[] = [];
    const contextChunks: string[] = [];

    if (matches && (matches as MatchRow[]).length > 0) {
      for (const match of matches as MatchRow[]) {
        if (match.content_type === "article") {
          const { data: article } = await supabase
            .from("articles")
            .select("id, title, summary, source")
            .eq("id", match.content_id)
            .single();

          if (article) {
            sources.push({
              type: "article",
              title: article.title,
              id: article.id,
            });
            contextChunks.push(
              `[Article: "${article.title}" — ${article.source || "unknown source"}]\n${article.summary || "No summary available."}`,
            );
          }
        } else if (match.content_type === "thesis") {
          const { data: thesis } = await supabase
            .from("theses")
            .select("id, title, sector, rationale, conviction, horizon")
            .eq("id", match.content_id)
            .single();

          if (thesis) {
            sources.push({
              type: "thesis",
              title: thesis.title || `${thesis.sector} thesis`,
              id: thesis.id,
            });
            contextChunks.push(
              `[Thesis: "${thesis.title}" — ${thesis.sector} (${thesis.conviction}, ${thesis.horizon || "medium-term"})]\n${thesis.rationale || "No rationale available."}`,
            );
          }
        }
      }
    }

    /* ── 4. Build conversation contents ── */
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
      parts: [{ text: message }],
    });

    /* ── 5. Generate response ── */
    const completion = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: conversationContents,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.4,
        maxOutputTokens: 1500,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const response = completion.text;
    if (!response) {
      return NextResponse.json(
        { error: "Gemini returned an empty response — retry" },
        { status: 500 },
      );
    }

    return NextResponse.json({ response, sources });
  } catch (err) {
    console.error("[intelligence] error:", err);
    return NextResponse.json(
      { error: "Failed to generate intelligence response" },
      { status: 500 },
    );
  }
}
