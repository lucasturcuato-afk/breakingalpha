"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import {
  Star,
  Plus,
  Trash2,
  Sparkles,
  ExternalLink,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";
import { createBrowserClient } from "@supabase/ssr";
import { MemoModal } from "@/components/memo/MemoModal";

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

interface WatchlistEntry {
  id: string;
  identifier: string;
  type: string;
  created_at?: string;
}

interface WatchlistPrice {
  price: number;
  pct: number;
}

interface MatchedArticle {
  id: string;
  title: string;
  source?: string;
  sector?: string;
  industry_verticals?: string[];
  activity_types?: string[];
  published_at?: string;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const SECTORS = [
  "Technology M&A", "Private Equity", "Venture Capital", "Public Markets",
  "Geopolitics & Macro", "Fintech & Crypto", "Healthcare & Biotech", "Energy & Climate",
];

export default function WatchlistPage() {
  const router = useRouter();
  const [memoEntry, setMemoEntry] = useState<WatchlistEntry | null>(null);
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);
  const [prices, setPrices] = useState<Record<string, WatchlistPrice>>({});
  const [matches, setMatches] = useState<MatchedArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [addType, setAddType] = useState<"ticker" | "company" | "sector">("ticker");
  const [addError, setAddError] = useState("");

  const refreshWatchlist = useCallback(async () => {
    try {
      const res = await fetch("/api/watchlist");
      if (!res.ok) {
        console.error("Watchlist fetch failed:", res.status);
        return;
      }
      const { entries } = await res.json();
      // Deduplicate by (normalized identifier, type) — handles any legacy duplicates
      // already in the DB from the old batch insert path
      const seen = new Set<string>();
      const newEntries = (entries || []).filter((e: WatchlistEntry) => {
        const key = `${e.identifier.toUpperCase()}::${e.type}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setWatchlist(newEntries);

      // Fetch prices for tickers
      const tickers = newEntries.filter((e: WatchlistEntry) => e.type === "ticker").map((e: WatchlistEntry) => e.identifier);
      if (tickers.length > 0) {
        fetch(`/api/watchlist-quotes?symbols=${tickers.join(",")}`)
          .then((r) => r.json())
          .then((d) => { if (d.quotes) setPrices(d.quotes); })
          .catch(() => {});
      }

      // Fetch matching articles
      if (newEntries.length > 0) {
        const identifiers = newEntries.map((e: WatchlistEntry) => e.identifier.toLowerCase());
        const { data: articles } = await getSupabase()
          .from("articles")
          .select("id, title, source, sector, industry_verticals, activity_types, published_at, ingested_at, summary, companies")
          .order("relevance_score", { ascending: false })
          .limit(50);

        if (articles) {
          const matched = articles.filter((a) => {
            const title = (a.title || "").toLowerCase();
            const summary = (a.summary || "").toLowerCase();
            let cos = a.companies;
            if (typeof cos === "string") { try { cos = JSON.parse(cos); } catch { cos = []; } }
            const compStr = Array.isArray(cos) ? cos.map((c: string) => c.toLowerCase()).join(" ") : "";
            return identifiers.some((ident: string) => title.includes(ident) || summary.includes(ident) || compStr.includes(ident));
          });
          setMatches(matched.slice(0, 20).map((a) => ({
            id: a.id,
            title: a.title,
            source: a.source,
            sector: a.sector,
            industry_verticals: a.industry_verticals ?? [],
            activity_types: a.activity_types ?? [],
            published_at: a.published_at || a.ingested_at,
          })));
        }
      } else {
        setMatches([]);
      }
    } catch (e) {
      console.error("Failed to refresh watchlist:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshWatchlist();
  }, [refreshWatchlist]);

  const handleAdd = async () => {
    const identifier = input.trim();
    if (!identifier) return;
    setAddError("");

    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, type: addType }),
      });
      if (!res.ok) {
        const body = await res.json();
        setAddError(body.error || "Failed to add");
        return;
      }
      setInput("");
      await refreshWatchlist();
    } catch {
      setAddError("Network error");
    }
  };

  const handleRemove = async (id: string) => {
    try {
      await fetch("/api/watchlist", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      await refreshWatchlist();
    } catch (e) {
      console.error("Failed to remove:", e);
    }
  };

  const handleAddSector = async (sectorName: string) => {
    const isTracked = watchlist.some((e) => e.identifier.toLowerCase() === sectorName.toLowerCase());
    if (isTracked) return;

    try {
      await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: sectorName, type: "sector" }),
      });
      await refreshWatchlist();
    } catch (e) {
      console.error("Failed to add sector:", e);
    }
  };

  // Stats
  const tickers = watchlist.filter((e) => e.type === "ticker");
  const gainers = tickers.filter((e) => prices[e.identifier]?.pct > 0).length;
  const losers = tickers.filter((e) => prices[e.identifier]?.pct < 0).length;

  return (
    <AppShell pageTitle="Watchlist" mood="neutral" moodHeadline="Markets steady" moodDetails={["VIX 14.2", "S&P +0.38%"]}>
      <div className="p-6 max-w-[800px]">
        {/* Header */}
        <p className="font-sans text-[12px] text-text-muted mb-5">
          Track companies, tickers, and sectors. Articles matching your watchlist are boosted in relevance.
        </p>

        {/* Add form */}
        <div className="bg-white border border-border-base rounded-xl p-4 mb-5">
          <div className="flex gap-2 mb-2.5">
            <Input
              value={input}
              onChange={(e) => { setInput(e.target.value); setAddError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter" && input.trim()) handleAdd(); }}
              placeholder="e.g. NVDA, Anthropic, Private Equity"
              className="flex-1 font-data"
            />
            <button
              type="button"
              onClick={handleAdd}
              className="px-4 py-2 rounded-lg bg-gold text-cream font-sans text-[11px] font-bold hover:bg-gold-dark transition-colors cursor-pointer flex-shrink-0"
            >
              ADD
            </button>
          </div>
          {addError && <p className="font-sans text-[11px] text-signal-dn mb-2">{addError}</p>}
          <div className="flex gap-1.5">
            {(["ticker", "company", "sector"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setAddType(t)}
                className={cn(
                  "px-3 py-1 rounded-md font-data text-[10px] cursor-pointer transition-colors",
                  addType === t
                    ? "bg-gold-muted border border-gold-border text-gold font-semibold"
                    : "bg-parchment-mid border border-border-base text-text-muted hover:text-text-primary",
                )}
              >
                {t.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Quick add sectors */}
        <div className="mb-5">
          <p className="font-data text-[9px] uppercase tracking-widest text-text-muted mb-2">Quick Add Sector</p>
          <div className="flex flex-wrap gap-1.5">
            {SECTORS.map((s) => {
              const isTracked = watchlist.some((e) => e.identifier.toLowerCase() === s.toLowerCase());
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => handleAddSector(s)}
                  disabled={isTracked}
                  className={cn(
                    "px-2.5 py-1 rounded-md font-data text-[10px] cursor-pointer transition-colors",
                    isTracked
                      ? "bg-parchment-mid text-text-faint border border-border-base opacity-50 cursor-default"
                      : "bg-gold-muted border border-gold-border text-gold hover:bg-gold/10",
                  )}
                >
                  {s}{isTracked ? " \u2713" : ""}
                </button>
              );
            })}
          </div>
        </div>

        {/* Stats */}
        {tickers.length > 0 && (
          <div className="grid grid-cols-4 gap-2 mb-5">
            {[
              { label: "Watching", value: watchlist.length, icon: <Star size={12} />, color: "text-gold" },
              { label: "Gainers", value: gainers, icon: <TrendingUp size={12} />, color: "text-signal-up" },
              { label: "Losers", value: losers, icon: <TrendingDown size={12} />, color: "text-signal-dn" },
              { label: "Flat", value: tickers.length - gainers - losers, icon: <Minus size={12} />, color: "text-text-muted" },
            ].map((s) => (
              <div key={s.label} className="bg-white border border-border-base rounded-xl p-3 text-center">
                <div className={cn("flex items-center justify-center gap-1 mb-0.5", s.color)}>
                  {s.icon}
                  <span className="font-data text-[16px] font-bold">{s.value}</span>
                </div>
                <p className="font-data text-[9px] text-text-muted uppercase tracking-wider">{s.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Watchlist entries */}
        <div className="mb-6">
          <p className="font-data text-[9px] uppercase tracking-widest text-text-muted mb-2.5">
            Tracking ({watchlist.length})
          </p>

          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 rounded-xl" />)}
            </div>
          ) : watchlist.length === 0 ? (
            <EmptyState
              icon={<Star size={32} />}
              title="Nothing tracked yet"
              description="Add a ticker, company, or sector above to start tracking"
            />
          ) : (
            <div className="space-y-1.5">
              {watchlist.map((entry) => {
                const price = prices[entry.identifier];
                return (
                  <div
                    key={entry.id}
                    className="flex items-center gap-3 px-4 py-2.5 bg-white border border-border-base rounded-xl group"
                  >
                    <span className="font-data text-[13px] font-bold text-text-primary flex-1 truncate">
                      {entry.identifier}
                    </span>

                    {entry.type === "ticker" && price && (
                      <span className={cn(
                        "font-data text-[12px] tabular-nums",
                        price.pct >= 0 ? "text-signal-up" : "text-signal-dn",
                      )}>
                        ${price.price} {price.pct >= 0 ? "+" : ""}{price.pct}%
                      </span>
                    )}

                    <span className="font-data text-[9px] text-gold bg-gold-muted border border-gold-border px-1.5 py-0.5 rounded-md flex-shrink-0 uppercase">
                      {entry.type}
                    </span>

                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={() => setMemoEntry(entry)}
                        className="p-1 rounded-md hover:bg-parchment-mid cursor-pointer"
                        aria-label="Generate memo"
                      >
                        <Sparkles size={11} className="text-gold" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemove(entry.id)}
                        className="p-1 rounded-md hover:bg-parchment-mid cursor-pointer"
                        aria-label="Remove"
                      >
                        <Trash2 size={11} className="text-text-faint hover:text-signal-dn" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Matching articles feed */}
        {watchlist.length > 0 && (
          <div>
            <p className="font-data text-[9px] uppercase tracking-widest text-text-muted mb-2.5">
              Watchlist Feed ({matches.length})
            </p>
            {matches.length === 0 ? (
              <EmptyState
                icon={<ExternalLink size={24} />}
                title="No matching articles yet"
                description="Recent articles matching your watchlist will appear here"
                className="py-8"
              />
            ) : (
              <div className="space-y-2">
                {matches.map((a) => (
                  <div key={a.id} className="bg-white border border-border-base rounded-xl p-3">
                    <div className="flex items-center gap-2 mb-1">
                      {a.sector && <Badge variant="default">{a.sector}</Badge>}
                      {a.source && <span className="font-data text-[9px] text-text-muted">{a.source}</span>}
                      {a.published_at && (
                        <span className="font-data text-[9px] text-text-faint ml-auto">
                          {timeAgo(a.published_at)}
                        </span>
                      )}
                    </div>
                    <h4 className="font-sans text-[13px] font-semibold text-espresso leading-snug">
                      {a.title}
                    </h4>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {memoEntry && (
        <MemoModal
          isOpen={true}
          onClose={() => setMemoEntry(null)}
          title={memoEntry.identifier}
          content={`Watchlist item: ${memoEntry.identifier}\nType: ${memoEntry.type}`}
          type="deal"
        />
      )}
    </AppShell>
  );
}
