import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { getSupabaseWithUser } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/**
 * Follows CRUD. A follow is a pointer into the already-ingested corpus.
 * Creation may make ONE bounded enrichment step (ticker -> company-name
 * resolution via our own companies table; topic -> one embedding call).
 * Matching itself (following-feed) never calls external APIs.
 *
 * Degrades gracefully when the follows table has not been created yet
 * (migration sql/0011): GET returns { follows: [], unavailable: true }.
 */

const FOLLOW_TYPES = ["ticker", "company", "industry", "activity", "topic"] as const;
type FollowType = (typeof FOLLOW_TYPES)[number];

const INDUSTRY_VERTICALS = [
  "Technology", "Healthcare & Biotech", "Energy & Oil/Gas", "Financial Services",
  "Consumer & Retail", "Industrials & Manufacturing", "Aerospace & Defense",
  "Real Estate", "Media & Telecom", "Materials & Mining", "Agriculture",
];
const ACTIVITY_TYPES = [
  "Mergers & Acquisitions", "Private Equity", "Venture Capital",
  "IPO & Capital Markets", "Earnings & Results", "Macro & Policy", "Geopolitics",
  "Regulation & Legal", "Fundraising", "Crypto & Digital Assets",
  "Leadership & Operations",
];

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  return error?.code === "42P01" || /does not exist/i.test(error?.message ?? "");
}

export async function GET() {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data, error } = await supabase
    .from("follows")
    .select("id, follow_type, target, display_name, matched_keywords, muted, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (error) {
    if (isMissingTable(error)) {
      return NextResponse.json({ follows: [], unavailable: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ follows: data ?? [] });
}

export async function POST(request: NextRequest) {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { follow_type?: string; target?: string; display_name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const followType = (body.follow_type ?? "").trim() as FollowType;
  const target = (body.target ?? "").trim();
  if (!FOLLOW_TYPES.includes(followType) || !target) {
    return NextResponse.json({ error: "follow_type and target required" }, { status: 400 });
  }
  if (target.length > 120) {
    return NextResponse.json({ error: "target too long" }, { status: 400 });
  }
  if (followType === "industry" && !INDUSTRY_VERTICALS.includes(target)) {
    return NextResponse.json({ error: "unknown industry" }, { status: 400 });
  }
  if (followType === "activity" && !ACTIVITY_TYPES.includes(target)) {
    return NextResponse.json({ error: "unknown activity" }, { status: 400 });
  }

  const row: Record<string, unknown> = {
    user_id: user.id,
    follow_type: followType,
    target: followType === "ticker" ? target.toUpperCase() : target,
    display_name: (body.display_name ?? "").trim() || null,
    matched_keywords: null as string[] | null,
    embedding: null as string | null,
  };

  // Ticker: resolve the company name from OUR companies table (articles
  // carry no ticker column). No external API.
  if (followType === "ticker") {
    const { data: company } = await supabase
      .from("companies")
      .select("name")
      .eq("ticker", row.target)
      .limit(1)
      .maybeSingle();
    const name = company?.name?.trim();
    row.matched_keywords = name ? [name] : [];
    if (!row.display_name) row.display_name = name ?? (row.target as string);
  }

  if (followType === "company") {
    row.matched_keywords = [target];
    if (!row.display_name) row.display_name = target;
  }

  // Topic: ONE embedding call at creation; stored for read-time matching
  // through the existing match_content_embeddings RPC.
  if (followType === "topic") {
    const words = target
      .split(/\s+/)
      .map((w) => w.replace(/[^\w&'-]/g, ""))
      .filter((w) => w.length >= 4);
    row.matched_keywords = [target, ...words.slice(0, 4)];
    if (!row.display_name) row.display_name = target;
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const embedResponse = await ai.models.embedContent({
        model: "gemini-embedding-001",
        contents: target,
        config: { outputDimensionality: 768 },
      });
      const values = embedResponse.embeddings?.[0]?.values;
      if (values) row.embedding = JSON.stringify(values);
    } catch (err) {
      // Keyword matching still works without the embedding; note and move on.
      console.warn("[follows] topic embedding failed, keyword-only:", err);
    }
  }

  const { data, error } = await supabase
    .from("follows")
    .insert(row)
    .select("id, follow_type, target, display_name, matched_keywords, muted, created_at")
    .single();

  if (error) {
    if (isMissingTable(error)) {
      return NextResponse.json(
        { error: "Follows are not set up yet (migration pending)." },
        { status: 503 },
      );
    }
    if (error.code === "23505") {
      return NextResponse.json({ error: "Already following" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ follow: data });
}

export async function PATCH(request: NextRequest) {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { id?: string; muted?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.id || typeof body.muted !== "boolean") {
    return NextResponse.json({ error: "id and muted required" }, { status: 400 });
  }
  const { error } = await supabase
    .from("follows")
    .update({ muted: body.muted })
    .eq("id", body.id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const { error } = await supabase
    .from("follows")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
