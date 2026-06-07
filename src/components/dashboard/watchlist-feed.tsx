"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { ExternalLink, Eye } from "lucide-react";
import { InfoTooltip } from "@/components/ui/info-tooltip";

interface WatchlistArticle {
  article_id: string;
  identifier: string;
  title: string;
  url: string;
  source: string;
  source_type: string;
  summary: string | null;
  published_at: string | null;
  relevance_score: number | null;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const hrs = Math.floor(diff / 3600000);
  if (hrs < 1) return "just now";
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function WatchlistFeed() {
  const [articles, setArticles] = useState<WatchlistArticle[]>([]);
  const [identifiers, setIdentifiers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/watchlist-feed");
        if (!res.ok) return;
        const json = await res.json();
        setArticles(json.articles ?? []);
        setIdentifiers(json.identifiers ?? []);
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="bg-parchment dark:bg-elevated border border-border-base rounded-2xl p-5">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-parchment-mid rounded w-1/3" />
          <div className="h-3 bg-parchment-mid rounded w-full" />
          <div className="h-3 bg-parchment-mid rounded w-2/3" />
        </div>
      </div>
    );
  }

  if (identifiers.length === 0) return null;

  return (
    <div className="bg-parchment dark:bg-elevated border border-border-base rounded-2xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Eye size={14} className="text-gold" />
          <h3 className="font-display text-[15px] font-bold text-espresso inline-flex items-center gap-1.5">
            Watchlist Feed
            <InfoTooltip content="Real-time articles mentioning companies on your watchlist." side="right" iconSize={12} />
          </h3>
        </div>
        <span className="font-data text-[9px] uppercase tracking-widest text-text-muted">
          {identifiers.length} tracked
        </span>
      </div>

      {articles.length === 0 ? (
        <p className="font-sans text-[12px] text-text-muted italic">
          No recent articles for your watchlist. Check back later.
        </p>
      ) : (
        <div className="space-y-2.5">
          {articles.slice(0, 8).map((a) => (
            <a
              key={a.article_id}
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group block"
            >
              <div className="flex items-start gap-2">
                <span
                  className={cn(
                    "shrink-0 mt-1 px-1.5 py-0.5 rounded font-data text-[8px] font-bold uppercase",
                    "bg-gold-muted text-gold border border-gold/20",
                  )}
                >
                  {a.identifier}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-sans text-[12px] text-text-primary group-hover:text-gold transition-colors line-clamp-1">
                    {a.title}
                    <ExternalLink
                      size={9}
                      className="inline ml-1 opacity-0 group-hover:opacity-60 transition-opacity"
                    />
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="font-data text-[9px] text-text-muted">
                      {a.source}
                    </span>
                    {a.published_at && (
                      <span className="font-data text-[9px] text-text-faint">
                        {timeAgo(a.published_at)}
                      </span>
                    )}
                    {a.relevance_score != null && (
                      <span className="font-data text-[9px] text-gold/70">
                        {a.relevance_score}/10
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
