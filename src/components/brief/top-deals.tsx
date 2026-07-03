"use client";

import { cn } from "@/lib/utils";
import { stripHtml } from "@/lib/strip-html";

export interface TopDealItem {
  company: string;
  value?: string;
  deal_type?: string;
  one_liner?: string;
}

interface TopDealsProps {
  deals: TopDealItem[];
}

/**
 * Top Deals editorial treatment.
 *
 * - First deal renders as a feature card: larger serif company name, gold
 *   mono value, deal-type pill, 2-line summary, gold accent stripe on left.
 * - Subsequent deals render as compact horizontal rows with a 4-column grid
 *   (company | deal-type pill | value | 1-line summary).
 *
 * Replaces the inline 3-col grid previously inlined in morning-brief/page.tsx.
 */
export function TopDeals({ deals }: TopDealsProps) {
  if (!deals || deals.length === 0) return null;

  const [feature, ...rest] = deals;

  return (
    <div className="flex flex-col gap-2.5">
      {/* Feature card */}
      <article
        className={cn(
          "relative p-5 rounded-xl border border-border-base bg-white dark:bg-elevated",
          "border-l-[3px] border-l-gold",
          "card-hover-lift transition-all duration-[var(--duration-base)] ease-[var(--ease-out)]",
        )}
      >
        <div className="flex items-start justify-between gap-3 mb-2">
          <h4 className="font-display text-[18px] font-bold leading-snug text-espresso dark:text-cream">
            {feature.company}
          </h4>
          {feature.value && (
            <span className="font-data text-[15px] font-semibold text-gold flex-shrink-0 mt-0.5">
              {feature.value}
            </span>
          )}
        </div>
        {feature.deal_type && (
          <span className="inline-block font-sans text-[9px] uppercase font-bold text-text-muted bg-parchment-mid px-1.5 py-0.5 rounded mb-2">
            {feature.deal_type}
          </span>
        )}
        {feature.one_liner && (
          <p className="font-sans text-[13px] text-text-secondary dark:text-[#e8e8e4] leading-snug line-clamp-2">
            {stripHtml(feature.one_liner)}
          </p>
        )}
      </article>

      {/* Compact rows */}
      {rest.length > 0 && (
        <div className="rounded-xl border border-border-base bg-white dark:bg-elevated overflow-hidden">
          {rest.map((deal, i) => (
            <div
              key={`${deal.company}-${i}`}
              className={cn(
                "grid grid-cols-[1fr_auto_auto_2fr] items-center gap-3 py-3.5 px-4",
                i !== rest.length - 1 && "border-b border-border-subtle",
                "transition-colors duration-150 hover:bg-parchment-mid/40 dark:hover:bg-overlay",
              )}
            >
              <h5 className="font-display text-[14px] font-semibold text-espresso dark:text-cream truncate">
                {deal.company}
              </h5>
              <span className="flex-shrink-0">
                {deal.deal_type ? (
                  <span className="font-sans text-[9px] uppercase font-bold text-text-muted bg-parchment-mid px-1.5 py-0.5 rounded">
                    {deal.deal_type}
                  </span>
                ) : null}
              </span>
              <span className="font-data text-[12px] font-semibold text-gold flex-shrink-0">
                {deal.value || "—"}
              </span>
              <p className="font-sans text-[12px] text-text-secondary dark:text-[#e8e8e4] truncate">
                {deal.one_liner ? stripHtml(deal.one_liner) : ""}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default TopDeals;
