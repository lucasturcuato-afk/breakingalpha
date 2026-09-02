"use client";

import { useState } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";

/**
 * MoreSourcesDisclosure — the "N more sources" expander.
 *
 * EXTRACTED, NOT NEW. This markup shipped inline inside
 * src/app/watchlist/[identifier]/page.tsx and was the only same-event
 * disclosure in the product. Top Stories needed the same affordance, so rather
 * than author a second one this was lifted out verbatim and both surfaces now
 * render it. The company page keeps its exact previous appearance; that is the
 * point of extracting rather than rewriting.
 *
 * Two visual variants, because the two hosts sit on opposite grounds:
 *   "light" — the company page's cream/white article list (the original).
 *   "dark"  — the dashboard hero, which is a dark card.
 * The variant changes colors only. Structure, sizing, copy, chevron rotation
 * and the singular/plural rule are identical in both.
 *
 * Open state is local. Each instance owns its own toggle, so a list of these
 * does not need a Map in its parent (the company page previously kept one).
 */

export interface MoreSourcesItem {
  id: string;
  title: string | null;
  source?: string | null;
  url?: string | null;
  published_at?: string | null;
}

interface MoreSourcesDisclosureProps {
  items: MoreSourcesItem[];
  /** Relative-time formatter, injected so this component owns no date policy. */
  formatTime?: (iso: string) => string | null;
  variant?: "light" | "dark";
  className?: string;
}

const PALETTE = {
  light: {
    accent: "#d97706",
    card: "bg-white border border-border-base",
    source: "text-text-muted",
    time: "text-text-faint",
    title: "text-espresso",
    link: "text-gold hover:text-gold-dark",
  },
  dark: {
    accent: "#e8c169",
    card: "bg-white/[0.04] border border-white/10",
    source: "text-white/50",
    time: "text-white/35",
    title: "text-[#f6ecdb]",
    link: "text-[#e8c169] hover:text-[#f6ecdb]",
  },
} as const;

export function MoreSourcesDisclosure({
  items,
  formatTime,
  variant = "light",
  className,
}: MoreSourcesDisclosureProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // No duplicates means no affordance. Rendering an empty "0 more sources"
  // control would put a dead toggle on every story, which is the common case.
  if (items.length === 0) return null;

  const c = PALETTE[variant];

  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={isExpanded}
        onClick={(e) => {
          // The hero card is itself clickable; without this the disclosure
          // would also trigger the card's own open handler.
          e.stopPropagation();
          setIsExpanded((v) => !v);
        }}
        className="flex items-center gap-1.5 mt-1 ml-2 font-sans text-[10px] cursor-pointer transition-colors"
        style={{ color: c.accent, background: "none", border: "none", padding: "2px 4px" }}
      >
        <ChevronDown
          size={12}
          style={{
            transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.18s ease",
          }}
        />
        {isExpanded
          ? "Collapse"
          : `${items.length} more source${items.length === 1 ? "" : "s"}`}
      </button>

      {isExpanded && (
        <div className="space-y-1 mt-1 ml-3">
          {items.map((ra) => {
            const when = ra.published_at && formatTime ? formatTime(ra.published_at) : null;
            return (
              <div
                key={ra.id}
                className={`${c.card} rounded-xl p-2.5`}
                style={{ borderLeft: `2px solid ${c.accent}` }}
              >
                <div className="flex flex-wrap items-center gap-1.5 mb-1">
                  {ra.source && (
                    <span className={`font-sans text-[9px] ${c.source}`}>{ra.source}</span>
                  )}
                  {when && (
                    <span className={`font-sans text-[9px] ${c.time} ml-auto`}>{when}</span>
                  )}
                </div>
                <div className="flex items-start gap-2">
                  <h4
                    className={`font-display text-[12px] font-bold ${c.title} leading-snug flex-1`}
                  >
                    {ra.title}
                  </h4>
                  {ra.url && (
                    <a
                      href={ra.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className={`${c.link} flex-shrink-0 mt-0.5`}
                    >
                      <ExternalLink size={10} />
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default MoreSourcesDisclosure;
