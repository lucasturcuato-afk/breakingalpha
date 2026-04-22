/**
 * POST /api/brief/send-email
 *
 * Body: {
 *   briefing_id?: string;
 *   briefing_type?: "morning" | "evening";
 *   to: string[];
 *   subject?: string;
 * }
 *
 * Auth required. Renders the <BriefEmail /> component to HTML via react-email
 * and dispatches via Resend. If RESEND_API_KEY is not configured, returns 503.
 */

import { NextRequest, NextResponse } from "next/server";
import { render } from "@react-email/render";
import { Resend } from "resend";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { BriefEmail, type BriefEmailPayload } from "@/components/brief/brief-email";
import { createElement } from "react";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function safeParseJSON(val: unknown) {
  if (!val) return null;
  if (typeof val === "object") return val;
  try {
    return JSON.parse(val as string);
  } catch {
    return null;
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

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json(
      { error: "Email service not configured. Contact admin." },
      { status: 503 },
    );
  }

  let body: {
    briefing_id?: string;
    briefing_type?: "morning" | "evening";
    to?: string[];
    subject?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const to = Array.isArray(body.to) ? body.to.map((x) => String(x).trim()).filter(Boolean) : [];
  if (to.length === 0) {
    return NextResponse.json(
      { error: "`to` must be a non-empty array of email addresses" },
      { status: 400 },
    );
  }
  const invalid = to.filter((e) => !EMAIL_RE.test(e));
  if (invalid.length > 0) {
    return NextResponse.json(
      { error: `Invalid email address(es): ${invalid.join(", ")}` },
      { status: 400 },
    );
  }

  const briefingId = typeof body.briefing_id === "string" ? body.briefing_id : null;
  const briefingType =
    body.briefing_type === "morning" || body.briefing_type === "evening"
      ? body.briefing_type
      : "morning";

  const query = supabase.from("briefings").select("*");
  const { data, error } = briefingId
    ? await query.eq("id", briefingId).limit(1)
    : await query
        .eq("briefing_type", briefingType)
        .neq("headline", "Market Intelligence Unavailable")
        .order("created_at", { ascending: false })
        .limit(1);

  if (error) {
    console.error("[send-email] supabase error:", error.message);
    return NextResponse.json(
      { error: "Failed to fetch briefing" },
      { status: 500 },
    );
  }
  const raw = data?.[0];
  if (!raw) {
    return NextResponse.json({ error: "Briefing not found" }, { status: 404 });
  }

  const payload: BriefEmailPayload = {
    headline: raw.headline ?? undefined,
    summary: raw.summary ?? undefined,
    market_tone: raw.market_tone ?? undefined,
    sections: (safeParseJSON(raw.sections) as Record<string, string> | null) ?? null,
    top_deals: (safeParseJSON(raw.top_deals) as BriefEmailPayload["top_deals"]) ?? [],
    sector_breakdown:
      (safeParseJSON(raw.sector_breakdown) as Record<string, string> | null) ?? null,
    created_at: raw.created_at ?? undefined,
    market_pulse:
      (safeParseJSON(raw.market_pulse) as BriefEmailPayload["market_pulse"]) ?? null,
    briefing_type: (raw.briefing_type as "morning" | "evening") ?? briefingType,
  };

  let html: string;
  try {
    const element = createElement(BriefEmail, { briefing: payload });
    html = await render(element as React.ReactElement);
  } catch (e) {
    console.error("[send-email] render error:", e);
    return NextResponse.json(
      { error: "Failed to render email" },
      { status: 500 },
    );
  }

  const defaultSubject =
    payload.briefing_type === "evening"
      ? "Signalera Evening Wrap"
      : "Signalera Morning Brief";
  const subject = (body.subject && body.subject.trim()) || defaultSubject;

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const from = process.env.EMAIL_FROM_ADDRESS ?? "briefs@signalera.com";
    const result = await resend.emails.send({
      from,
      to,
      subject,
      html,
    });
    if (result.error) {
      console.error("[send-email] resend error:", result.error);
      return NextResponse.json(
        {
          error:
            typeof result.error === "object" && "message" in result.error
              ? (result.error as { message: string }).message
              : "Resend failed",
        },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true, id: result.data?.id ?? null, to });
  } catch (e) {
    console.error("[send-email] dispatch error:", e);
    const msg = e instanceof Error ? e.message : "Email dispatch failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

/**
 * GET /api/brief/send-email — returns a render preview of the HTML email for
 * the current user (no send). Used by the "Preview HTML email" menu item.
 */
export async function GET(request: NextRequest) {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) {
    return NextResponse.json(
      { error: "Not authenticated" },
      { status: 401 },
    );
  }

  const briefingType =
    request.nextUrl.searchParams.get("briefing_type") === "evening"
      ? "evening"
      : "morning";
  const briefingId = request.nextUrl.searchParams.get("briefing_id");

  const query = supabase.from("briefings").select("*");
  const { data, error } = briefingId
    ? await query.eq("id", briefingId).limit(1)
    : await query
        .eq("briefing_type", briefingType)
        .neq("headline", "Market Intelligence Unavailable")
        .order("created_at", { ascending: false })
        .limit(1);

  if (error || !data?.[0]) {
    return NextResponse.json({ error: "Briefing not found" }, { status: 404 });
  }

  const raw = data[0];
  const payload: BriefEmailPayload = {
    headline: raw.headline ?? undefined,
    summary: raw.summary ?? undefined,
    market_tone: raw.market_tone ?? undefined,
    sections: (safeParseJSON(raw.sections) as Record<string, string> | null) ?? null,
    top_deals: (safeParseJSON(raw.top_deals) as BriefEmailPayload["top_deals"]) ?? [],
    sector_breakdown:
      (safeParseJSON(raw.sector_breakdown) as Record<string, string> | null) ?? null,
    created_at: raw.created_at ?? undefined,
    market_pulse:
      (safeParseJSON(raw.market_pulse) as BriefEmailPayload["market_pulse"]) ?? null,
    briefing_type: (raw.briefing_type as "morning" | "evening") ?? briefingType,
  };

  try {
    const element = createElement(BriefEmail, { briefing: payload });
    const html = await render(element as React.ReactElement);
    return NextResponse.json({ html });
  } catch (e) {
    console.error("[send-email GET] render error:", e);
    return NextResponse.json({ error: "Render failed" }, { status: 500 });
  }
}
