"use client";

import { cn } from "@/lib/utils";
import { ExternalLink, Sparkles } from "lucide-react";

export interface CitationArticle {
  id: string;
  title: string;
  source: string;
  timestamp: string;
  url?: string;
}

interface CitationsPanelProps {
  citations?: CitationArticle[];
  hasMemo?: boolean;
}

const defaultCitations: CitationArticle[] = [
  { id: "c1", title: "Stripe doubles down on developer tools with Lemon Squeezy acquisition", source: "TechCrunch", timestamp: "2h ago", url: "#" },
  { id: "c2", title: "Fintech M&A heats up as valuations compress from 2021 peaks", source: "Bloomberg", timestamp: "5h ago", url: "#" },
  { id: "c3", title: "Payment processing consolidation: who's next after Stripe-Adyen?", source: "Financial Times", timestamp: "1d ago", url: "#" },
  { id: "c4", title: "SaaS deal multiples stabilize at 8-12x forward revenue", source: "PitchBook", timestamp: "1d ago", url: "#" },
  { id: "c5", title: "Developer-first payments: the new competitive moat", source: "a16z Blog", timestamp: "2d ago", url: "#" },
];

export function CitationsPanel({ citations = defaultCitations, hasMemo = false }: CitationsPanelProps) {
  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-border-base">
        <h2 className="font-sans text-[10px] font-semibold uppercase tracking-widest text-text-muted">
          Citations & Context
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {/* Related articles */}
        <div className="mb-5">
          <h3 className="font-sans text-[10px] font-semibold uppercase tracking-widest text-text-faint mb-2.5">
            Related Articles
          </h3>
          <div className="space-y-1">
            {citations.map((article, i) => (
              <div
                key={article.id}
                className={cn(
                  "flex items-start gap-2 py-2 px-2 rounded-lg group",
                  "transition-colors duration-[var(--duration-fast)]",
                  "hover:bg-parchment-mid",
                )}
              >
                <span className="font-data text-[10px] text-text-faint font-bold flex-shrink-0 w-4 text-right mt-0.5">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-sans text-[11px] text-text-primary leading-snug line-clamp-2">
                    {article.title}
                  </p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="font-sans text-[10px] text-text-muted">
                      {article.source}
                    </span>
                    <span className="font-data text-[9px] text-text-faint">
                      {article.timestamp}
                    </span>
                  </div>
                </div>
                {article.url && (
                  <a
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity mt-0.5"
                  >
                    <ExternalLink size={10} className="text-text-faint hover:text-gold" />
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* AI actions */}
        {hasMemo && (
          <div>
            <h3 className="font-sans text-[10px] font-semibold uppercase tracking-widest text-text-faint mb-2.5">
              AI Actions
            </h3>
            <div className="space-y-1.5">
              {[
                "Deepen competitive analysis",
                "Find comparable transactions",
                "Assess regulatory risk",
                "Generate investment thesis",
              ].map((action) => (
                <button
                  key={action}
                  type="button"
                  disabled
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2 rounded-lg",
                    "bg-parchment border border-border-base",
                    "font-sans text-[11px] text-text-faint",
                    "opacity-60 cursor-not-allowed text-left",
                  )}
                  title="Coming soon"
                >
                  <Sparkles size={10} className="text-gold flex-shrink-0" />
                  {action}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
