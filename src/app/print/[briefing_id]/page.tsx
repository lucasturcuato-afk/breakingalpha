/**
 * /print/[briefing_id] — server-rendered print view of a brief.
 *
 * Auth model (post-fix):
 *   - Authenticates via the user's Supabase session cookies. Puppeteer
 *     receives those cookies via `page.setCookie()` from the export-pdf
 *     route, so its render context is identical to the user's browser.
 *   - For each render, derive `session.access_token` and relay it to
 *     `/api/briefing?type=...` as `Authorization: Bearer ...` — the same
 *     call the live `/morning-brief` page makes. This gives the print
 *     route exact parity with the web view: PR #103 watchlist-baked
 *     content, Lucas's section / sector_breakdown reshaping, and the
 *     V4B per-user addendum (when the migration is applied) all flow
 *     through automatically.
 *
 *   - HMAC-token validation (legacy from PR #131) is preserved as an
 *     optional defense-in-depth check: if a request arrives with a
 *     valid `?t=` token, that's enough to render even without cookies
 *     (the resulting brief is un-personalized — graceful fallback).
 *     If neither cookies nor a valid token are present, return 404 so
 *     leaked URLs can't surface briefing content.
 *
 *   - VIX / theses count / stories use the anon key (matches the web
 *     UI's RLS-permitted reads). Service role is no longer required.
 *
 * Runtime: nodejs (Supabase SSR client is not edge-compatible).
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cookies, headers } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { verifyPrintToken } from "@/lib/print-token";
import { PrintBrief, type PrintStory } from "@/components/brief/print-brief";
import { stripHtml } from "@/lib/strip-html";
import { formatPTDateLong } from "@/lib/format-pt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Per-render metadata: the PDF Title field (set by Puppeteer from the
 * rendered <title>) is the user-visible artefact in macOS Finder /
 * Acrobat. We inject the briefing date and headline so the title looks
 * like "Morning Brief — April 27, 2026 · <headline>" rather than the
 * static layout fallback.
 *
 * Soft-fails: if the briefing fetch fails here, we fall back to the
 * layout-level "Signalera — Print View" title. The validator in
 * /api/brief/export-pdf still catches missing brief content via the
 * data-print-brief-root marker.
 */
export async function generateMetadata({
  params,
  searchParams,
}: PageProps): Promise<Metadata> {
  const { briefing_id } = await params;
  const sp = await searchParams;
  const type: "morning" | "evening" =
    sp.type === "evening" ? "evening" : "morning";
  const label = type === "evening" ? "Evening Wrap" : "Morning Brief";

  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error("missing supabase env");
    const sb = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data } = await sb
      .from("briefings")
      .select("headline, created_at")
      .eq("id", briefing_id)
      .limit(1)
      .single();
    if (data) {
      const date = formatPTDateLong(data.created_at ?? null);
      const headline =
        typeof data.headline === "string" && data.headline.trim()
          ? data.headline.replace(/\s+/g, " ").trim().slice(0, 80)
          : null;
      const title = headline
        ? `${label} — ${date} · ${headline}`
        : `${label} — ${date}`;
      return { title };
    }
  } catch {
    /* fall through to default */
  }
  return { title: `Signalera ${label}` };
}

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

function anonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Supabase env vars missing — NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");
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

interface BriefingApiResponse {
  briefing: Record<string, unknown> | null;
  pref_applied?: boolean;
  personalization?: { format_label?: string } | null;
  user_addendum?: string | null;
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
  const type: "morning" | "evening" =
    sp.type === "evening" ? "evening" : "morning";

  // ── Auth: cookie session OR HMAC token (defense-in-depth) ──
  const cookieStore = await cookies();
  const supabaseSSR = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { session },
  } = await supabaseSSR.auth.getSession();

  const tokenValid = verifyPrintToken(sp.t ?? null, briefing_id);
  if (!session && !tokenValid) {
    console.error(
      `[print] auth failed briefing_id=${briefing_id} (no session, no valid token) — returning 404`,
    );
    notFound();
  }
  console.log(
    `[print] render briefing_id=${briefing_id} type=${type} authPath=${session ? "session" : "token"}`,
  );

  // ── Origin for internal /api fetches ──
  // Prefer the explicit ?origin= passed by the export-pdf route (Puppeteer
  // gets called with the same origin as the user's request). Fall back to
  // x-forwarded headers, then NEXT_PUBLIC_SITE_URL, then localhost.
  const reqHeaders = await headers();
  const origin =
    (typeof sp.origin === "string" && sp.origin) ||
    (() => {
      const proto = reqHeaders.get("x-forwarded-proto") || "https";
      const host = reqHeaders.get("x-forwarded-host") || reqHeaders.get("host");
      return host ? `${proto}://${host}` : null;
    })() ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "http://localhost:3000";

  // Forward the user's session cookies to /api/briefing. /api/briefing
  // validates auth via @supabase/ssr cookie reads, not Authorization
  // headers. Sending Bearer alone returned 401 because /api/briefing
  // never inspected the header. This makes the server-to-server fetch
  // auth-shape identical to what the browser sends from /morning-brief.
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const briefingHeaders: HeadersInit = cookieHeader
    ? { Cookie: cookieHeader }
    : {};
  let payload: BriefingApiResponse | null = null;
  try {
    const res = await fetch(`${origin}/api/briefing?type=${type}`, {
      headers: briefingHeaders,
      cache: "no-store",
    });
    if (res.ok) {
      payload = (await res.json()) as BriefingApiResponse;
    } else {
      console.error(
        `[print] /api/briefing returned ${res.status} (hasAuth=${!!session})`,
      );
    }
  } catch (e) {
    console.error("[print] briefing fetch failed:", e);
  }

  const row = payload?.briefing;
  if (!row) {
    console.error(
      `[print] no briefing row from /api/briefing (hasAuth=${!!session}) — returning 404`,
    );
    // No briefing available — let the export-pdf validator catch this
    // via the missing data-print-brief-root marker.
    notFound();
  }

  if (typeof row.id === "string" && row.id !== briefing_id) {
    console.warn(
      `[print] URL briefing_id=${briefing_id} differs from latest ` +
        `id=${row.id}; rendering the user's actual current view (latest).`,
    );
  }

  // Normalise row into the print payload shape. /api/briefing returns
  // shaped objects already, but be defensive in case anything is a string.
  const sections = safeParse<Record<string, string>>(row.sections) ?? {};
  const sectorBreakdown =
    safeParse<Record<string, string>>(row.sector_breakdown) ?? {};
  const topDeals =
    safeParse<
      Array<{
        company: string;
        value?: string;
        deal_type?: string;
        one_liner?: string;
        sentiment?: string | null;
      }>
    >(row.top_deals) ?? [];
  const marketPulse = safeParse<{
    sentiment_word?: string;
    narrative?: string;
    headlines?: Array<{ title: string; href?: string; tone?: string }>;
  }>(row.market_pulse);
  const morningReview = safeParse<{
    aggregate_sentence?: string;
    sector_reflections?: Array<{
      sector: string;
      verdict: "correct" | "wrong" | "partial";
      paragraph: string;
    }>;
    ticker_reflection?: {
      symbol: string;
      verdict: "correct" | "wrong" | "partial";
      paragraph: string;
    } | null;
  }>(row.morning_review);

  const kind: "morning" | "evening" =
    row.briefing_type === "evening" ? "evening" : "morning";

  // ── Top stories (anon-permitted reads) ──
  const supabase = anonClient();
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

  let thesesCount: number | null = null;
  try {
    const { count } = await supabase
      .from("theses")
      .select("id", { count: "exact", head: true });
    if (typeof count === "number") thesesCount = count;
  } catch {
    /* soft-fail */
  }

  const vix = await loadVix(origin);

  return (
    <PrintBrief
      briefing={{
        id: typeof row.id === "string" ? row.id : briefing_id,
        briefing_type: kind,
        headline: typeof row.headline === "string" ? row.headline : undefined,
        summary: typeof row.summary === "string" ? row.summary : undefined,
        lead_paragraph:
          typeof row.lead_paragraph === "string" ? row.lead_paragraph : undefined,
        supporting_context:
          typeof row.supporting_context === "string"
            ? row.supporting_context
            : undefined,
        what_to_watch:
          typeof row.what_to_watch === "string" ? row.what_to_watch : undefined,
        market_tone:
          typeof row.market_tone === "string" ? row.market_tone : undefined,
        sections,
        sector_breakdown: sectorBreakdown,
        top_deals: topDeals,
        created_at: typeof row.created_at === "string" ? row.created_at : null,
        market_pulse: marketPulse,
        morning_review: morningReview,
      }}
      stories={stories}
      thesesCount={thesesCount}
      vix={vix}
      formatLabel={payload?.personalization?.format_label ?? null}
      userAddendum={
        typeof payload?.user_addendum === "string" && payload.user_addendum
          ? payload.user_addendum
          : null
      }
    />
  );
}
