/**
 * POST /api/brief/export-pdf
 *
 * Body: { briefing_id?: string; briefing_type?: "morning" | "evening" }
 * Either `briefing_id` (explicit row) or `briefing_type` (latest) must be provided.
 *
 * Renders the <BriefPdf /> React component to a PDF buffer via @react-pdf/renderer
 * and streams it back with `Content-Disposition: attachment`.
 *
 * React PDF requires the Node runtime.
 */

import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { BriefPdf, type BriefPdfPayload } from "@/components/brief/brief-pdf";
import { createElement } from "react";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeParseJSON(val: unknown) {
  if (!val) return null;
  if (typeof val === "object") return val;
  try {
    return JSON.parse(val as string);
  } catch {
    return null;
  }
}

function dateSlug(iso?: string | null): string {
  try {
    const d = iso ? new Date(iso) : new Date();
    return d.toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export async function POST(request: NextRequest) {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) {
    return NextResponse.json(
      { error: "Not authenticated" },
      { status: 401 },
    );
  }

  let body: { briefing_id?: string; briefing_type?: "morning" | "evening" } = {};
  try {
    body = (await request.json()) ?? {};
  } catch {
    body = {};
  }

  const briefingId = typeof body.briefing_id === "string" ? body.briefing_id : null;
  const briefingType =
    body.briefing_type === "morning" || body.briefing_type === "evening"
      ? body.briefing_type
      : "morning";

  // Fetch briefing — by id if provided, else latest of the given type.
  const query = supabase.from("briefings").select("*");
  const { data, error } = briefingId
    ? await query.eq("id", briefingId).limit(1)
    : await query
        .eq("briefing_type", briefingType)
        .neq("headline", "Market Intelligence Unavailable")
        .order("created_at", { ascending: false })
        .limit(1);

  if (error) {
    console.error("[export-pdf] supabase error:", error.message);
    return NextResponse.json(
      { error: "Failed to fetch briefing" },
      { status: 500 },
    );
  }
  const raw = data?.[0];
  if (!raw) {
    return NextResponse.json({ error: "Briefing not found" }, { status: 404 });
  }

  const payload: BriefPdfPayload = {
    headline: raw.headline ?? undefined,
    summary: raw.summary ?? undefined,
    market_tone: raw.market_tone ?? undefined,
    sections: (safeParseJSON(raw.sections) as Record<string, string> | null) ?? null,
    top_deals: (safeParseJSON(raw.top_deals) as BriefPdfPayload["top_deals"]) ?? [],
    sector_breakdown:
      (safeParseJSON(raw.sector_breakdown) as Record<string, string> | null) ?? null,
    created_at: raw.created_at ?? undefined,
    market_pulse:
      (safeParseJSON(raw.market_pulse) as BriefPdfPayload["market_pulse"]) ?? null,
    briefing_type: (raw.briefing_type as "morning" | "evening") ?? briefingType,
  };

  let buffer: Buffer;
  try {
    // react-pdf's renderToBuffer types expect a ReactElement<DocumentProps>.
    // BriefPdf returns a <Document> at the top level so this is runtime-safe;
    // cast through unknown to satisfy the narrow generic.
    const element = createElement(BriefPdf, { briefing: payload });
    buffer = (await renderToBuffer(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      element as any,
    )) as Buffer;
  } catch (e) {
    console.error("[export-pdf] render error:", e);
    return NextResponse.json(
      { error: "Failed to render PDF" },
      { status: 500 },
    );
  }

  const kind = payload.briefing_type === "evening" ? "evening-wrap" : "morning-brief";
  const filename = `signalera-${kind}-${dateSlug(payload.created_at)}.pdf`;

  // Cast Buffer to a BodyInit that Next's Response accepts.
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store, no-cache",
    },
  });
}
