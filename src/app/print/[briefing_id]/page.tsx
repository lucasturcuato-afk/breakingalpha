/**
 * /print/[briefing_id] — server-rendered print view of a brief.
 *
 * Access model (spec Section 4.1 / Open Question 3):
 *   - HMAC-gated via `?t=<token>` minted by `/api/brief/export-pdf`.
 *   - Not intended for end-user linking. Puppeteer navigates here with
 *     a 15-min signed token, renders, and closes.
 *   - Returns `notFound()` on missing/invalid token so leaked URLs 404
 *     rather than exposing briefing content.
 *
 * Data flow:
 *   - Uses the service-role Supabase client (no user session needed —
 *     Puppeteer does not ship cookies). Briefing lookup is read-only.
 *   - Articles for the Top Stories block come from the same 24h/48h
 *     fallback query the live Morning Brief + Evening Wrap pages use.
 *   - VIX + theses count: reads from /api/watchlist-quotes and from
 *     the theses table directly. Server-side so the PDF doesn't depend
 *     on client JS hydration.
 *
 * Runtime: nodejs (Supabase service-role import is not edge-compatible).
 */

import { notFound } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { verifyPrintToken } from "@/lib/print-token";
import { PrintBrief, type PrintStory } from "@/components/brief/print-brief";
import { stripHtml } from "@/lib/strip-html";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function safeParse<T>(v: unknown): T | null {
  if (v == null) return null;
  if (typeof v === "object") return v as T;
  try {
    return JSON.parse(v as string) as T;
  } catch {
    return null;
  }
}

function timeAgo(dateStr?: string | null): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function sentimentFromDb(s: string | null): string {
  if (!s) return "neutral";
  const l = s.toLowerCase();
  if (l === "positive" || l === "bullish") return "bullish";
  if (l === "negative" || l === "bearish") return "bearish";
  return "neutral";
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Supabase env vars missing — NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function loadVix(origin: string | null): Promise<{ price: string; pct: number } | null> {
  if (!origin) return null;
  try {
    const res = await fetch(
      `${origin}/api/watchlist-quotes?symbols=${encodeURIComponent("^VIX,VIXY")}`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    const qd = await res.json();
    const q = qd?.quotes?.["^VIX"] ?? qd?.quotes?.VIXY;
    if (!q) return null;
    const price =
      typeof q.price === "number"
        ? q.price.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })
        : String(q.price ?? "—");
    return { price, pct: q.pct ?? 0 };
  } catch {
    return null;
  }
}

interface PageProps {
  params: Promise<{ briefing_id: string }>;
  searchParams: Promise<{ t?: string; type?: string; origin?: string }>;
}

export default async function PrintBriefPage({
  params,
  searchParams,
}: PageProps) {
  const { briefing_id } = await params;
  const sp = await searchParams;

  // HMAC gate. Invalid / missing / expired → 404.
  const verified = verifyPrintToken(sp.t ?? null, briefing_id);
  if (!verified) {
    notFound();
  }

  const supabase = serviceClient();

  const { data: row, error } = await supabase
    .from("briefings")
    .select("*")
    .eq("id", briefing_id)
    .limit(1)
    .single();

  if (error || !row) {
    notFound();
  }

  // Normalise row into the print payload shape.
  const sections = safeParse<Record<string, string>>(row.sections) ?? {};
  const sectorBreakdown = safeParse<Record<string, string>>(row.sector_breakdown) ?? {};
  const topDeals = safeParse<
    Array<{ company: string; value?: string; deal_type?: string; one_liner?: string; sentiment?: string | null }>
  >(row.top_deals) ?? [];
  const marketPulse = safeParse<{
    sentiment_word?: string;
    narrative?: string;
    headlines?: Array<{ title: string; href?: string; tone?: string }>;
  }>(row.market_pulse);
  const morningReview = safeParse<{
    aggregate_sentence?: string;
    sector_reflections?: Array<{ sector: string; verdict: "correct" | "wrong" | "partial"; paragraph: string }>;
    ticker_reflection?: { symbol: string; verdict: "correct" | "wrong" | "partial"; paragraph: string } | null;
  }>(row.morning_review);

  const kind: "morning" | "evening" =
    row.briefing_type === "evening" ? "evening" : "morning";

  // Top Stories — mirror live page 24h → 48h fallback query. Server
  // components run once per request so Date.now() is stable within a
  // render; the purity lint rule is a React-client-component concern.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const cutoff24h = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
  const cutoff48h = new Date(nowMs - 48 * 60 * 60 * 1000).toISOString();

  const articlesSelect =
    "id, title, source, sector, sentiment, summary, content, published_at, ingested_at, url, companies, relevance_score";

  let articlesRes = await supabase
    .from("articles")
    .select(articlesSelect)
    .gte("ingested_at", cutoff24h)
    .order("relevance_score", { ascending: false })
    .limit(8);
  if ((articlesRes.data?.length ?? 0) < 3) {
    articlesRes = await supabase
      .from("articles")
      .select(articlesSelect)
      .gte("ingested_at", cutoff48h)
      .order("relevance_score", { ascending: false })
      .limit(8);
  }
  const stories: PrintStory[] = (articlesRes.data ?? []).map((a) => ({
    id: a.id,
    title: a.title || "Untitled",
    source: a.source || "Unknown",
    timestamp: timeAgo(a.published_at || a.ingested_at),
    sentiment: sentimentFromDb(a.sentiment),
    sector: a.sector || undefined,
    summary: a.summary ? stripHtml(a.summary) : undefined,
    url: a.url || undefined,
  }));
  // Thesis count.
  let thesesCount: number | null = null;
  try {
    const { count } = await supabase
      .from("theses")
      .select("id", { count: "exact", head: true });
    if (typeof count === "number") thesesCount = count;
  } catch {
    /* soft-fail */
  }

  // VIX snapshot. Uses origin from `?origin=` (passed by Puppeteer
  // driver) so the fetch hits the same deployment the print page is
  // rendering from. Falls back to NEXT_PUBLIC_SITE_URL.
  const originCandidate =
    (typeof sp.origin === "string" && sp.origin) ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    null;
  const vix = await loadVix(originCandidate);

  return (
    <PrintBrief
      briefing={{
        id: row.id,
        briefing_type: kind,
        headline: row.headline ?? undefined,
        summary: row.summary ?? undefined,
        lead_paragraph: row.lead_paragraph ?? undefined,
        supporting_context: row.supporting_context ?? undefined,
        what_to_watch: row.what_to_watch ?? undefined,
        market_tone: row.market_tone ?? undefined,
        sections,
        sector_breakdown: sectorBreakdown,
        top_deals: topDeals,
        created_at: row.created_at ?? null,
        market_pulse: marketPulse,
        morning_review: morningReview,
      }}
      stories={stories}
      thesesCount={thesesCount}
      vix={vix}
    />
  );
}
