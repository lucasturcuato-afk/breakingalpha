/**
 * /print/[briefing_id] server-rendered print view of a brief.
 *
 * Auth: Supabase session cookies only. Puppeteer receives those cookies
 * via page.setCookie() from the export-pdf route, so its render context
 * is identical to the user's browser. The page forwards the same
 * cookies to /api/briefing, which reads them via @supabase/ssr. If
 * cookies are missing or invalid, the page returns 404.
 *
 * VIX / theses count / stories use the anon key (matches the web UI's
 * RLS-permitted reads). Service role is no longer required.
 *
 * Runtime: nodejs (Supabase SSR client is not edge-compatible).
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cookies, headers } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import {
  PrintBrief,
  isAllowedDealType,
  type ActiveThesis,
  type PrintStory,
  type ThesisMentionSurface,
} from "@/components/brief/print-brief";
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

/* ── Active Theses selection helpers ──────────────────────────────── */

const THESIS_STOPWORDS: ReadonlySet<string> = new Set([
  "the",
  "this",
  "that",
  "these",
  "those",
  "with",
  "from",
  "into",
  "their",
  "what",
  "when",
  "where",
  "while",
  "would",
  "could",
  "should",
  "after",
  "before",
  "today",
  "tomorrow",
]);

/** Conviction priority used by the selection algorithm.
 *  HIGH > BULLISH > BEARISH > MEDIUM > WATCH > anything else. */
const CONVICTION_PRIORITY: Record<string, number> = {
  HIGH: 0,
  BULLISH: 1,
  BEARISH: 2,
  MEDIUM: 3,
  WATCH: 4,
};

function convictionRank(c?: string | null): number {
  const v = (c || "").toUpperCase().trim();
  return CONVICTION_PRIORITY[v] ?? 99;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Extract proper-noun candidates from a thesis title:
 *  capitalized 4+ char tokens, minus a small stopword list. */
function tokenizeProperNouns(s: string): string[] {
  const matches = s.match(/\b[A-Z][a-zA-Z]{3,}\b/g) ?? [];
  return matches.filter((m) => !THESIS_STOPWORDS.has(m.toLowerCase()));
}

interface CorpusInputs {
  topDeals: Array<{ company?: string }>;
  leadParagraph: string;
  supportingContext: string;
  whatToWatch: string;
  pulseNarrative: string;
  sections: Record<string, string>;
}

/** A single brief surface that the matcher can scan. Either a
 *  structured array of company anchors (top_deals) or freeform prose
 *  whose original casing is preserved so the matched anchor can be
 *  extracted verbatim. */
type Surface =
  | { key: ThesisMentionSurface; companies: string[] }
  | { key: ThesisMentionSurface; text: string };

/** Build the ordered surface list. Order matters: the FIRST surface
 *  to contain a match wins, and the rendered mention line names that
 *  surface. Ordered by how the reader perceives weight: top_deals →
 *  lead → what_to_watch → market_pulse → analyst-briefing sections.
 *  supporting_context is folded into the "lead" surface per the
 *  spec's grouping (Today's Lead covers both the lead paragraph and
 *  its supporting context). */
function buildSurfaces(inputs: CorpusInputs): Surface[] {
  const surfaces: Surface[] = [];
  const companies = inputs.topDeals
    .map((d) => (d.company || "").trim())
    .filter((c) => c.length > 0);
  if (companies.length > 0) {
    surfaces.push({ key: "top_deals", companies });
  }
  const leadCombined = [inputs.leadParagraph, inputs.supportingContext]
    .filter((s) => s && s.trim())
    .join(" ");
  if (leadCombined) surfaces.push({ key: "lead", text: leadCombined });
  if (inputs.whatToWatch && inputs.whatToWatch.trim()) {
    surfaces.push({ key: "what_to_watch", text: inputs.whatToWatch });
  }
  if (inputs.pulseNarrative && inputs.pulseNarrative.trim()) {
    surfaces.push({ key: "market_pulse", text: inputs.pulseNarrative });
  }
  // Analyst Briefing sections in the same order as MORNING_TAB_ORDER /
  // EVENING_TAB_ORDER (minus sector_spotlight which was cut in C13).
  const sectionKeys: ThesisMentionSurface[] = [
    "deals_and_ma",
    "public_markets",
    "macro_and_rates",
    "geopolitics",
  ];
  for (const k of sectionKeys) {
    const v = inputs.sections[k];
    if (v && v.trim()) surfaces.push({ key: k, text: v });
  }
  return surfaces;
}

interface SurfaceMatch {
  surface: ThesisMentionSurface;
  anchor: string;
}

/** Try to match `tok` (whole-word, case-insensitive) inside a single
 *  surface. Returns the anchor in original-source casing on hit. */
function matchInSurface(
  surface: Surface,
  tok: string,
): SurfaceMatch | null {
  if (!tok) return null;
  const re = new RegExp(`\\b${escapeRegex(tok)}\\b`, "i");
  if ("companies" in surface) {
    for (const c of surface.companies) {
      if (re.test(c)) return { surface: surface.key, anchor: c };
    }
    return null;
  }
  const m = surface.text.match(re);
  if (!m) return null;
  // m[0] is the matched substring in its original source casing.
  return { surface: surface.key, anchor: m[0] };
}

/** Walk surfaces in priority order. Try ticker first (when present),
 *  then proper-noun title tokens. First hit anywhere wins. */
function findFirstMatch(
  surfaces: Surface[],
  ticker: string,
  titleTokens: string[],
): SurfaceMatch | null {
  for (const s of surfaces) {
    if (ticker) {
      const m = matchInSurface(s, ticker);
      if (m) return m;
    }
    for (const tok of titleTokens) {
      const m = matchInSurface(s, tok);
      if (m) return m;
    }
  }
  return null;
}

/** Selection algorithm — see C14 commit message and PR #136 spec.
 *  1. fetch up to 50 non-expired theses, newest first
 *  2. compute matched_today + mention_surface + mention_anchor by
 *     scanning brief surfaces in priority order, preserving the
 *     anchor's original source casing for downstream rendering
 *  3. greedy pick: matched first (sorted by conviction), then non-
 *     matched (also by conviction), filling to 3 with sector diversity
 *  Soft-fails: any error returns []. */
type ThesesClient = Pick<ReturnType<typeof createClient>, "from">;

async function selectActiveTheses(
  supabase: ThesesClient,
  inputs: CorpusInputs,
): Promise<ActiveThesis[]> {
  let rows: Array<{
    id: string;
    title: string | null;
    conviction: string | null;
    rationale: string | null;
    sector: string | null;
    catalyst: string | null;
    ticker: string | null;
    generated_at: string | null;
  }> = [];
  try {
    const res = await supabase
      .from("theses")
      .select(
        "id, title, conviction, rationale, sector, catalyst, ticker, generated_at",
      )
      .or("expired.is.null,expired.eq.false")
      .order("generated_at", { ascending: false })
      .limit(50);
    rows = res.data ?? [];
  } catch (e) {
    console.warn("[print] active-theses fetch failed:", e);
    return [];
  }

  if (rows.length === 0) return [];

  const surfaces = buildSurfaces(inputs);

  const enriched: ActiveThesis[] = rows.map((t) => {
    const ticker = (t.ticker || "").trim();
    const title = (t.title || "").trim();
    const titleTokens = title ? tokenizeProperNouns(title) : [];
    const hit = findFirstMatch(surfaces, ticker, titleTokens);

    return {
      id: t.id,
      title: title || "Untitled thesis",
      conviction: t.conviction,
      rationale: t.rationale,
      sector: t.sector,
      catalyst: t.catalyst,
      ticker: ticker || null,
      matched_today: !!hit,
      mention_surface: hit ? hit.surface : null,
      mention_anchor: hit ? hit.anchor : null,
    };
  });

  // Sort by conviction, then generated_at desc for ties.
  const byPriority = (
    a: ActiveThesis & { generated_at?: string | null },
    b: ActiveThesis & { generated_at?: string | null },
  ): number => {
    const ra = convictionRank(a.conviction);
    const rb = convictionRank(b.conviction);
    if (ra !== rb) return ra - rb;
    const ga = a.generated_at || "";
    const gb = b.generated_at || "";
    return gb.localeCompare(ga);
  };

  // Attach generated_at for stable tiebreaker without leaking it into
  // the ActiveThesis surface that the component consumes.
  const enrichedWithGen = enriched.map((t, i) => ({
    ...t,
    generated_at: rows[i]?.generated_at ?? null,
  }));

  const matched = enrichedWithGen
    .filter((t) => t.matched_today)
    .sort(byPriority);
  const nonMatched = enrichedWithGen
    .filter((t) => !t.matched_today)
    .sort(byPriority);

  // Greedy pick with sector diversity. A thesis with no sector can't
  // collide, so it always passes the diversity gate.
  const picked: ActiveThesis[] = [];
  const usedSectors = new Set<string>();
  const tryPick = (t: ActiveThesis): void => {
    if (picked.length >= 3) return;
    const s = (t.sector || "").trim().toLowerCase();
    if (s && usedSectors.has(s)) return;
    picked.push({
      id: t.id,
      title: t.title,
      conviction: t.conviction,
      rationale: t.rationale,
      sector: t.sector,
      catalyst: t.catalyst,
      ticker: t.ticker,
      matched_today: t.matched_today,
      mention_surface: t.mention_surface,
      mention_anchor: t.mention_anchor,
    });
    if (s) usedSectors.add(s);
  };
  for (const t of matched) tryPick(t);
  for (const t of nonMatched) tryPick(t);

  return picked;
}

interface PageProps {
  params: Promise<{ briefing_id: string }>;
  searchParams: Promise<{ type?: string; origin?: string }>;
}

export default async function PrintBriefPage({
  params,
  searchParams,
}: PageProps) {
  const { briefing_id } = await params;
  const sp = await searchParams;
  const type: "morning" | "evening" =
    sp.type === "evening" ? "evening" : "morning";

  // Auth: cookie session only. /api/briefing reads the same cookies, so
  // unauthenticated requests cannot mint a personalized brief here.
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

  if (!session) {
    console.error(
      `[print] auth failed briefing_id=${briefing_id} (no session), returning 404`,
    );
    notFound();
  }
  console.log(
    `[print] render briefing_id=${briefing_id} type=${type} authPath=session`,
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

  // Q4 — deal_type fallback via deal_flow (Bug #1 inverted priority).
  //
  // Synthesis is generally accurate — it sees the article body and
  // labels deals correctly more often than the structured extractor
  // does (e.g. Rheinmetall: synthesis "Strategic Investment" right;
  // deal_flow "Asset Sale" wrong). The original C11 implementation
  // unconditionally let deal_flow win, which corrupted correct
  // synthesis values. Inverted here: trust synthesis when its value
  // passes the display allowlist; only fall back to deal_flow when
  // synthesis emits something outside the allowlist (the actual
  // hallucination case). PrintBrief's allowlist gate then drops the
  // pill silently if neither source produces a valid value.
  //
  // Soft-fails — if deal_flow is unavailable we keep synthesis values
  // and let the allowlist gate the pill.
  let topDealsCorrected = topDeals;
  const dealCompanies = topDeals
    .map((d) => (d.company || "").trim())
    .filter((c) => c.length > 0);
  if (dealCompanies.length > 0) {
    try {
      const flowRes = await supabase
        .from("deal_flow")
        .select("company, deal_type, created_at")
        .in("company", dealCompanies)
        .order("created_at", { ascending: false })
        .limit(50);
      const flowMap = new Map<string, string>();
      for (const r of flowRes.data ?? []) {
        const key = (r.company || "").trim().toLowerCase();
        if (key && r.deal_type && !flowMap.has(key)) {
          flowMap.set(key, r.deal_type as string);
        }
      }
      topDealsCorrected = topDeals.map((d) => {
        // Synthesis-first: keep its value when allowlist-valid.
        if (isAllowedDealType(d.deal_type)) return d;
        // Otherwise consult deal_flow as fallback. If the fallback is
        // also outside the allowlist, leave the original value — the
        // PrintBrief allowlist gate will silently drop the pill.
        const key = (d.company || "").trim().toLowerCase();
        const override = flowMap.get(key);
        return override ? { ...d, deal_type: override } : d;
      });
    } catch (e) {
      console.warn(
        "[print] deal_flow deal_type fallback lookup failed (using synthesis values only):",
        e,
      );
    }
  }
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

  // ── Active Theses selection (C14) ─────────────────────────────────
  // Page 3 of the PDF renders up to 3 non-expired theses, prioritising
  // ones whose ticker or proper-noun title token surfaces in today's
  // brief content. Sector diversity is enforced. evidence_chain /
  // supporting_articles / bear_case / verifiable_signal are
  // intentionally ignored — the schema has them but population is
  // sparse and depending on them produces empty rows.
  const activeTheses: ActiveThesis[] = await selectActiveTheses(
    supabase,
    {
      topDeals: topDealsCorrected,
      leadParagraph: typeof row.lead_paragraph === "string" ? row.lead_paragraph : "",
      supportingContext:
        typeof row.supporting_context === "string" ? row.supporting_context : "",
      whatToWatch:
        typeof row.what_to_watch === "string" ? row.what_to_watch : "",
      pulseNarrative: marketPulse?.narrative ?? "",
      sections,
    },
  );

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
        top_deals: topDealsCorrected,
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
      activeTheses={activeTheses}
    />
  );
}
