import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { TickerStrip } from "@/components/brief/ticker-strip";
import { Wordmark } from "@/components/ui/wordmark";
import { stripHtml } from "@/lib/strip-html";
import { normalizeSections } from "@/lib/brief-sections";

/**
 * Public read-only brief view.
 *
 * No auth — uses the anon Supabase key and relies on an RLS policy permitting
 * anon `SELECT` on `briefings` (see `sql/0004_briefings_public_read.sql`).
 *
 * Renders the editorial content (headline, summary, analyst sections, top
 * deals, sector breakdown). Intentionally omits user-specific affordances
 * (rating thumbs, memo, add-thesis, addendum, right panel widgets).
 */

// Don't let these pages show up in search results.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// Avoid build-time caching — briefing rows update throughout the day.
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface TopDeal {
  company?: string;
  value?: string;
  deal_type?: string;
  one_liner?: string;
}

interface BriefingRow {
  id: string;
  briefing_type: string;
  headline: string | null;
  summary: string | null;
  market_tone: string | null;
  sections: unknown;
  top_deals: unknown;
  sector_breakdown: unknown;
  created_at: string | null;
}

const SECTION_TITLES: Record<string, string> = {
  macro_and_rates: "Macro & Rates",
  deals_and_ma: "Deals & M&A",
  public_markets: "Public Markets",
  geopolitics: "Geopolitics",
  sector_spotlight: "Sector Spotlight",
  what_to_watch: "What to Watch",
  tomorrow_setup: "Tomorrow's Setup",
  closing_thoughts: "Closing Thoughts",
};

function safeParse(val: unknown): Record<string, unknown> | unknown[] | null {
  if (val == null) return null;
  if (typeof val === "object") return val as Record<string, unknown> | unknown[];
  if (typeof val === "string") {
    try {
      return JSON.parse(val);
    } catch {
      return null;
    }
  }
  return null;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

function sectionTitle(key: string): string {
  return (
    SECTION_TITLES[key] ||
    key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

interface Props {
  params: Promise<{ id: string }>;
}

export default async function PublicBriefPage({ params }: Props) {
  const { id } = await params;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return notFound();
  }

  const supabase = createClient(url, anonKey);
  const { data, error } = await supabase
    .from("briefings")
    .select(
      "id, briefing_type, headline, summary, market_tone, sections, top_deals, sector_breakdown, created_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !data) {
    return notFound();
  }

  const briefing = data as BriefingRow;

  // This page reads Supabase directly, so /api/briefing normalization does not
  // reach it. Without this it does not crash, but it silently drops any section
  // whose value is not a string.
  const sections = normalizeSections(
    (safeParse(briefing.sections) as Record<string, unknown> | null) || {}
  );
  const sectorBreakdown =
    (safeParse(briefing.sector_breakdown) as Record<string, unknown> | null) || {};
  const topDealsRaw = safeParse(briefing.top_deals);
  const topDeals: TopDeal[] = Array.isArray(topDealsRaw) ? (topDealsRaw as TopDeal[]) : [];

  const sectionEntries = Object.entries(sections).filter(
    ([, v]) => typeof v === "string" && v.trim().length > 0,
  ) as [string, string][];
  const sectorEntries = Object.entries(sectorBreakdown).filter(
    ([, v]) => typeof v === "string" && v.trim().length > 0,
  ) as [string, string][];

  const kind = briefing.briefing_type === "evening" ? "Evening Wrap" : "Morning Brief";

  return (
    <div className="min-h-screen bg-parchment">
      {/* Header */}
      <header className="border-b border-border-base px-6 py-4 flex items-center justify-between bg-cream dark:bg-elevated">
        <Link href="/" className="inline-flex items-center">
          <Wordmark size="md" />
        </Link>
        <Link
          href="/auth"
          className="inline-flex items-center px-4 py-2 rounded-lg bg-gold text-cream font-sans text-[12px] font-semibold hover:bg-gold-dark transition-colors"
        >
          Sign up — Free
        </Link>
      </header>

      <TickerStrip />

      <main className="p-6 max-w-[960px] mx-auto">
        {/* Eyebrow */}
        <span className="font-sans text-[10px] uppercase tracking-widest text-text-muted">
          {kind}
          {briefing.created_at ? ` · ${formatDate(briefing.created_at)}` : ""}
        </span>

        {/* Headline */}
        {briefing.headline && (
          <h1 className="font-display text-[32px] font-bold mt-2 mb-4 text-espresso leading-tight">
            {briefing.headline}
          </h1>
        )}

        {/* Market tone (subtle) */}
        {briefing.market_tone && (
          <p
            className="font-sans mb-3"
            style={{
              color: "var(--gold)",
              fontSize: "10px",
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            Market tone · {briefing.market_tone}
          </p>
        )}

        {/* Summary */}
        {briefing.summary && (
          <p className="font-sans text-[16px] leading-relaxed text-text-primary whitespace-pre-line mb-8">
            {briefing.summary}
          </p>
        )}

        {/* Top Deals to Watch */}
        {topDeals.length > 0 && (
          <section className="mb-8">
            <div className="flex items-center gap-3 mb-3">
              <h2 className="font-sans text-[10px] uppercase tracking-widest font-bold text-text-muted">
                Top Deals to Watch
              </h2>
              <div className="flex-1 h-px bg-gold/15" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
              {topDeals.map((deal, i) => (
                <div
                  key={i}
                  className="p-3.5 rounded-xl border border-border-base dark:border-border-default border-t-2 border-t-gold/15 bg-white dark:bg-elevated"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <h4 className="font-sans text-[14px] font-semibold text-espresso">
                      {deal.company || "—"}
                    </h4>
                    <span className="font-data text-[11px] font-semibold text-gold flex-shrink-0 ml-2">
                      {deal.value || "Undisclosed"}
                    </span>
                  </div>
                  {deal.deal_type && (
                    <span className="inline-block font-data text-[9px] uppercase tracking-wide font-bold text-gold bg-gold-muted px-1.5 py-0.5 rounded mb-1.5">
                      {deal.deal_type}
                    </span>
                  )}
                  {deal.one_liner && (
                    <p className="font-sans text-[11px] text-text-secondary dark:text-[#e8e8e4] leading-snug">
                      {stripHtml(deal.one_liner)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Analyst Briefing */}
        {sectionEntries.length > 0 && (
          <section className="mb-8">
            <h2 className="font-sans text-[10px] uppercase tracking-widest font-bold text-text-muted mb-3">
              Analyst Briefing
            </h2>
            <div className="space-y-4">
              {sectionEntries.map(([key, content]) => (
                <article
                  key={key}
                  className="p-4 rounded-xl border border-border-base bg-white dark:bg-elevated"
                >
                  <h3 className="font-display text-[16px] font-bold text-espresso mb-2">
                    {sectionTitle(key)}
                  </h3>
                  <div className="font-sans text-[13px] leading-relaxed text-text-primary whitespace-pre-line">
                    {stripHtml(content)}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {/* Sector Breakdown */}
        {sectorEntries.length > 0 && (
          <section className="mb-8">
            <h2 className="font-sans text-[10px] uppercase tracking-widest font-bold text-text-muted mb-3">
              Sector Signals
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {sectorEntries.map(([sector, analysis]) => (
                <div
                  key={sector}
                  className="p-3.5 rounded-xl border border-border-base bg-white dark:bg-elevated"
                >
                  <h3 className="font-sans text-[11px] font-bold uppercase tracking-wide text-gold mb-1.5">
                    {sector}
                  </h3>
                  <p className="font-sans text-[12px] leading-relaxed text-text-primary whitespace-pre-line">
                    {stripHtml(analysis)}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      {/* CTA footer */}
      <footer className="border-t border-border-base px-6 py-8 text-center bg-cream dark:bg-elevated">
        <p className="font-sans text-[13px] text-text-secondary mb-3">
          Want briefings like this every morning?
        </p>
        <Link
          href="/auth"
          className="inline-block px-5 py-2.5 rounded-xl bg-gold text-cream font-sans text-[13px] font-semibold hover:bg-gold-dark transition-colors"
        >
          Try Signalera — Free
        </Link>
      </footer>
    </div>
  );
}
